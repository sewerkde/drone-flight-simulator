#!/usr/bin/env python3
"""Online odalar: aynı yerde uçan pilotların konumlarını birbirine aktarır.

WebSocket (RFC 6455), yalnız Python standart kütüphanesi. Sunucu durum tutmaz, sadece aktarır.

    python3 rooms.py [port] [bind]        varsayılan 8766, 127.0.0.1
    ws://localhost:8766/?room=<oda>

Mesajlar JSON:
    istemci → {"t":"hello","name":..,"vehicle":..}      bağlanınca bir kez
    istemci → {"t":"s", ...durum}                        ~10 Hz
    sunucu  → {"t":"welcome","id":..,"peers":[{id,name,vehicle}]}
    sunucu  → {"t":"join","id":..,"name":..,"vehicle":..} / {"t":"s","id":..,...} / {"t":"bye","id":..}

Düz HTTP: GET /rooms → {"rooms":[{"room","count","pilots":[{name,vehicle}]}],"total"} (lobi listesi)
"""
import base64
import hashlib
import json
import socketserver
import struct
import sys
import threading
import time
import urllib.parse

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8766
BIND = sys.argv[2] if len(sys.argv) > 2 else "127.0.0.1"
GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
MAX_ROOM = 40  # odada en fazla pilot
MAX_MSG = 4096  # bayt
MAX_RATE = 40  # saniyede en fazla mesaj (fazlası düşer)
MAX_LIST = 12  # /rooms: odada listelenen en fazla pilot
MAX_ROOMS_LIST = 200  # /rooms: en fazla oda

rooms = {}  # oda adı -> {id: Client}
lock = threading.Lock()
next_id = [1]


class Client:
    def __init__(self, sock, room):
        self.sock = sock
        self.room = room
        self.wlock = threading.Lock()
        self.name = "Pilot"
        self.vehicle = ""
        with lock:
            self.id = next_id[0]
            next_id[0] += 1

    def send(self, obj):
        data = json.dumps(obj, separators=(",", ":")).encode()
        header = bytearray([0x81])  # FIN + metin
        n = len(data)
        if n < 126:
            header.append(n)
        elif n < 65536:
            header += bytes([126]) + struct.pack(">H", n)
        else:
            header += bytes([127]) + struct.pack(">Q", n)
        try:
            with self.wlock:
                self.sock.sendall(bytes(header) + data)
        except OSError:
            pass


def recv_exact(sock, n):
    buf = b""
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise ConnectionError("kapandı")
        buf += chunk
    return buf


def read_frame(sock):
    b1, b2 = recv_exact(sock, 2)
    opcode = b1 & 0x0F
    masked = b2 & 0x80
    n = b2 & 0x7F
    if n == 126:
        n = struct.unpack(">H", recv_exact(sock, 2))[0]
    elif n == 127:
        n = struct.unpack(">Q", recv_exact(sock, 8))[0]
    if n > MAX_MSG:
        raise ConnectionError("mesaj çok büyük")
    mask = recv_exact(sock, 4) if masked else b"\0\0\0\0"
    data = bytearray(recv_exact(sock, n))
    for i in range(n):
        data[i] ^= mask[i % 4]
    return opcode, bytes(data)


def broadcast(room, obj, skip=None):
    with lock:
        targets = [c for c in rooms.get(room, {}).values() if c is not skip]
    for c in targets:
        c.send(obj)


def clean(text, n):
    return "".join(ch for ch in str(text) if ch.isprintable())[:n].strip()


def send_rooms(sock, head_only=False):
    # GET /rooms: başlangıç ekranındaki lobi için oda listesi (düz HTTP, sonra kapat)
    with lock:
        snap = [(room, list(members.values())) for room, members in rooms.items() if members]
    snap.sort(key=lambda r: (-len(r[1]), r[0]))
    body = json.dumps(
        {
            "rooms": [
                {
                    "room": room,
                    "count": len(members),
                    "pilots": [{"name": c.name, "vehicle": c.vehicle} for c in members[:MAX_LIST]],
                }
                for room, members in snap[:MAX_ROOMS_LIST]
            ],
            "total": sum(len(m) for _, m in snap),
        },
        separators=(",", ":"),
    ).encode()
    head = (
        "HTTP/1.1 200 OK\r\nContent-Type: application/json; charset=utf-8\r\n"
        f"Content-Length: {len(body)}\r\nAccess-Control-Allow-Origin: *\r\n"
        "Cache-Control: no-store\r\nConnection: close\r\n\r\n"
    ).encode()
    try:
        sock.sendall(head if head_only else head + body)
    except OSError:
        pass


class Handler(socketserver.BaseRequestHandler):
    def handle(self):
        sock = self.request
        sock.settimeout(30)
        # ---- el sıkışma
        raw = b""
        while b"\r\n\r\n" not in raw:
            chunk = sock.recv(2048)
            if not chunk or len(raw) > 8192:
                return
            raw += chunk
        lines = raw.decode("latin-1").split("\r\n")
        path = lines[0].split(" ")[1] if len(lines[0].split(" ")) > 1 else "/"
        headers = {}
        for line in lines[1:]:
            if ":" in line:
                k, v = line.split(":", 1)
                headers[k.strip().lower()] = v.strip()
        key = headers.get("sec-websocket-key")
        if headers.get("upgrade", "").lower() != "websocket" or not key:
            method = lines[0].split(" ")[0]
            if method in ("GET", "HEAD") and urllib.parse.urlparse(path).path.rstrip("/").endswith("/rooms"):
                send_rooms(sock, method == "HEAD")
            else:
                sock.sendall(b"HTTP/1.1 426 Upgrade Required\r\nContent-Length: 0\r\n\r\n")
            return
        accept = base64.b64encode(hashlib.sha1((key + GUID).encode()).digest()).decode()
        sock.sendall(
            (
                "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                f"Sec-WebSocket-Accept: {accept}\r\n\r\n"
            ).encode()
        )
        query = urllib.parse.parse_qs(urllib.parse.urlparse(path).query)
        room = clean(query.get("room", ["lobby"])[0], 64) or "lobby"

        with lock:
            members = rooms.setdefault(room, {})
            full = len(members) >= MAX_ROOM
        if full:
            sock.sendall(b"\x88\x02\x03\xf0")  # kapat: oda dolu
            return
        me = Client(sock, room)
        with lock:
            rooms[room][me.id] = me
        sent = 0
        window = time.time()
        try:
            while True:
                opcode, data = read_frame(sock)
                if opcode == 0x8:  # kapat
                    break
                if opcode == 0x9:  # ping → pong
                    with me.wlock:
                        sock.sendall(bytes([0x8A, len(data)]) + data)
                    continue
                if opcode != 0x1:
                    continue
                now = time.time()
                if now - window > 1:
                    window, sent = now, 0
                sent += 1
                if sent > MAX_RATE:
                    continue
                try:
                    msg = json.loads(data)
                except ValueError:
                    continue
                if msg.get("t") == "hello":
                    me.name = clean(msg.get("name", ""), 20) or "Pilot"
                    me.vehicle = clean(msg.get("vehicle", ""), 24)
                    with lock:
                        peers = [
                            {"id": c.id, "name": c.name, "vehicle": c.vehicle}
                            for c in rooms[room].values()
                            if c is not me
                        ]
                    me.send({"t": "welcome", "id": me.id, "peers": peers})
                    broadcast(room, {"t": "join", "id": me.id, "name": me.name, "vehicle": me.vehicle}, skip=me)
                elif msg.get("t") == "s":
                    msg["id"] = me.id
                    if "vehicle" in msg:
                        me.vehicle = clean(msg["vehicle"], 24)
                    broadcast(room, msg, skip=me)
        except (ConnectionError, OSError, ValueError):
            pass
        finally:
            with lock:
                rooms.get(room, {}).pop(me.id, None)
                if room in rooms and not rooms[room]:
                    del rooms[room]
            broadcast(room, {"t": "bye", "id": me.id})


class Server(socketserver.ThreadingTCPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    print(f"odalar: ws://{BIND}:{PORT}/?room=<oda>", flush=True)
    Server((BIND, PORT), Handler).serve_forever()
