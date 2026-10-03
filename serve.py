#!/usr/bin/env python3
"""Simülatörü yerelde sunar ve DJI kumandasını okuyup sayfaya iletir.

http://localhost:8765      sayfa
http://localhost:8765/rc   kumanda verisi (Server-Sent Events, ~60/sn)

Kumanda alttaki USB-C portundan bağlı olmalı. Takılıp çıkarılınca kendiliğinden yeniden bağlanır.
Yalnız Python standart kütüphanesi kullanır.
"""
import http.server
import json
import os
import re
import select
import struct
import subprocess
import sys
import termios
import threading
import time

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
DJI_VENDOR = 0x2CA3
os.chdir(os.path.dirname(os.path.abspath(__file__)))


# ---------------------------------------------------------------- DUML

def _table(poly):
    t = []
    for i in range(256):
        c = i
        for _ in range(8):
            c = (c >> 1) ^ poly if c & 1 else c >> 1
        t.append(c)
    return t


T8 = _table(0x8C)
T16 = _table(0x8408)


def crc8(data, seed=0x77):
    c = seed
    for b in data:
        c = T8[(b ^ c) & 0xFF]
    return c


def crc16(data, seed=0x3692):
    v = seed
    for b in data:
        v = (v >> 8) ^ T16[(b ^ v) & 0xFF]
    return v


def duml(cmd_set, cmd_id, payload=b""):
    length = 13 + len(payload)
    p = bytearray([0x55, length & 0xFF, (length >> 8) | 0x04])
    p.append(crc8(p))
    p += bytes([0x0A, 0x06]) + struct.pack("<H", 0x34EB) + bytes([0x40, cmd_set, cmd_id]) + payload
    p += struct.pack("<H", crc16(p))
    return bytes(p)


PKT_SIM_ON = duml(0x06, 0x24, b"\x01")
PKT_STICKS = duml(0x06, 0x01)
PKT_BUTTONS = duml(0x06, 0x27)


def axis(b):
    v = b[0] | (b[1] << 8)
    return max(-1.0, min(1.0, (v - 1024) / 660.0))


# ---------------------------------------------------------------- kumanda köprüsü

class RcBridge(threading.Thread):
    def __init__(self):
        super().__init__(daemon=True)
        self.lock = threading.Lock()
        self.state = {"rh": 0.0, "rv": 0.0, "lv": 0.0, "lh": 0.0, "wheel": 0.0, "btn": 0, "raw": ""}
        self.last = 0.0
        self.port = None
        self.status = "kumanda aranıyor"

    def snapshot(self):
        with self.lock:
            live = time.time() - self.last < 0.5
            return {**self.state, "live": live, "port": self.port, "status": self.status}

    @staticmethod
    def find_ports():
        try:
            out = subprocess.run(
                ["ioreg", "-r", "-c", "IOUSBHostDevice", "-l", "-w0"],
                capture_output=True, text=True, timeout=5,
            ).stdout
        except Exception:
            return []
        ports = []
        for block in re.split(r"^\+-o ", out, flags=re.M):
            if f'"idVendor" = {DJI_VENDOR}' in block:
                ports += re.findall(r'"IOCalloutDevice" = "([^"]+)"', block)
        return sorted(set(ports), key=lambda p: int(re.sub(r"\D", "", p) or 0))

    @staticmethod
    def open_port(path):
        fd = os.open(path, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
        a = termios.tcgetattr(fd)
        a[0] = a[1] = a[3] = 0
        a[2] = termios.CS8 | termios.CREAD | termios.CLOCAL
        a[4] = a[5] = termios.B115200
        a[6][termios.VMIN] = 0
        a[6][termios.VTIME] = 0
        termios.tcsetattr(fd, termios.TCSANOW, a)
        return fd

    def run(self):
        while True:
            ports = self.find_ports()
            if not ports:
                self.status = "kumanda bulunamadı"
                time.sleep(1.5)
                continue
            for path in ports:
                try:
                    self.serve(path)
                except OSError:
                    pass
                with self.lock:
                    self.port = None
            self.status = "kumanda yanıt vermiyor"
            time.sleep(1.0)

    def serve(self, path):
        fd = self.open_port(path)
        buf = bytearray()

        def send(pkt):
            try:
                os.write(fd, pkt)
            except BlockingIOError:
                pass

        try:
            self.status = f"{os.path.basename(path)} deneniyor"
            send(PKT_SIM_ON)
            t0 = time.time()
            next_poll = next_btn = next_sim = 0.0
            while True:
                now = time.time()
                if now >= next_poll:
                    send(PKT_STICKS)
                    next_poll = now + 0.02
                if now >= next_btn:
                    send(PKT_BUTTONS)
                    next_btn = now + 0.06
                if now >= next_sim:
                    send(PKT_SIM_ON)
                    next_sim = now + 3.0
                r, _, _ = select.select([fd], [], [], 0.01)
                if r:
                    chunk = os.read(fd, 4096)
                    if not chunk:
                        raise OSError("port kapandı")
                    buf += chunk
                    self.parse(buf)
                if self.last < t0 and now - t0 > 1.5:
                    return  # bu port veri vermiyor, sıradakini dene
                if self.last > t0:
                    if self.port != path:
                        with self.lock:
                            self.port = path
                        self.status = "bağlı"
                    if now - self.last > 2.0:
                        raise OSError("veri kesildi")
        finally:
            os.close(fd)

    def parse(self, buf):
        while True:
            i = buf.find(b"\x55")
            if i < 0:
                buf.clear()
                return
            if i:
                del buf[:i]
            if len(buf) < 4:
                return
            plen = struct.unpack("<H", buf[1:3])[0] & 0x03FF
            if plen < 13 or crc8(buf[:3]) != buf[3]:
                del buf[0]
                continue
            if len(buf) < plen:
                return
            f = bytes(buf[:plen])
            del buf[:plen]
            if struct.unpack("<H", f[-2:])[0] != crc16(f[:-2]):
                continue
            with self.lock:
                s = self.state
                if len(f) == 38 and f[10] == 0x01:
                    s["rh"], s["rv"], s["lv"], s["lh"], s["wheel"] = (
                        axis(f[o:o + 2]) for o in (13, 16, 19, 22, 25)
                    )
                    s["raw01"] = f[11:-2].hex()
                    self.last = time.time()
                elif len(f) == 21 and f[10] == 0x26:
                    s["rh"], s["rv"], s["lv"], s["lh"] = (axis(f[o:o + 2]) for o in (11, 13, 15, 17))
                    self.last = time.time()
                elif len(f) == 58 and f[10] == 0x27:
                    s["btn"] = (f[28] << 8) | f[29]
                    s["raw"] = f[11:56].hex()


bridge = RcBridge()


# ---------------------------------------------------------------- HTTP

class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".wasm": "application/wasm",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args):
        pass

    def do_POST(self):
        # Sayfanın durum günlüğü (Google modu). Anahtar gönderilmez; yine de maskelenir.
        if self.path != "/log":
            return self.send_error(404)
        n = min(int(self.headers.get("Content-Length") or 0), 20000)
        body = self.rfile.read(n).decode("utf-8", "replace")
        body = re.sub(r"key=[^&\s\"]+", "key=***", body)
        os.makedirs("logs", exist_ok=True)
        path = os.path.join("logs", "client.log")
        if os.path.exists(path) and os.path.getsize(path) > 2_000_000:
            os.replace(path, path + ".old")
        with open(path, "a") as f:
            f.write(time.strftime("%H:%M:%S ") + body + "\n")
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        if self.path.split("?")[0] != "/rc":
            return super().do_GET()
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        try:
            while True:
                self.wfile.write(f"data: {json.dumps(bridge.snapshot())}\n\n".encode())
                self.wfile.flush()
                time.sleep(1 / 60)
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass


if __name__ == "__main__":
    bridge.start()
    # varsayılan kuyruk (5) sayfa açılışındaki toplu istekte bağlantı sıfırlatıyordu (modeller yüklenmiyordu)
    http.server.ThreadingHTTPServer.request_queue_size = 64
    server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    server.daemon_threads = True
    server.serve_forever()
