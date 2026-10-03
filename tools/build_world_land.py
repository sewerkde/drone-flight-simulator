#!/usr/bin/env python3
"""Lobi haritası için küçük kara verisi: assets/world-land.json.

Kaynak: Natural Earth 110m land (kamu malı), GeoJSON.
    python3 tools/build_world_land.py [ne_110m_land.geojson]   dosya verilmezse indirir

Çıktı: {"v":1,"q":10,"lat":[güney,kuzey],"p":[[x0,y0,dx,dy,...],...]}
x = round(boylam*q), y = round(enlem*q); ilk nokta mutlak, sonrakiler fark. Halkalar kapalı varsayılır.
Antarktika ve çok küçük adalar atılır (harita -58°..84° arasını gösterir).
"""
import json
import math
import os
import sys
import urllib.request

URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "world-land.json")
Q = 10  # 0.1° hassasiyet
TOL = 0.18  # sadeleştirme toleransı (derece)
MIN_AREA = 0.6  # derece² altındaki adalar atılır
LAT = [-58, 84]


def load(src):
    if src:
        with open(src, encoding="utf-8") as f:
            return json.load(f)
    with urllib.request.urlopen(URL, timeout=30) as r:
        return json.load(r)


def seg_dist(p, a, b):
    (x, y), (x1, y1), (x2, y2) = p, a, b
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return math.hypot(x - x1, y - y1)
    t = max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)))
    return math.hypot(x - (x1 + t * dx), y - (y1 + t * dy))


def simplify(pts, tol):
    # Douglas-Peucker (yığınla, özyinelemesiz)
    if len(pts) < 4:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        best, idx = 0.0, -1
        for k in range(i + 1, j):
            d = seg_dist(pts[k], pts[i], pts[j])
            if d > best:
                best, idx = d, k
        if best > tol and idx > 0:
            keep[idx] = True
            stack += [(i, idx), (idx, j)]
    return [p for p, k in zip(pts, keep) if k]


def area(pts):
    return abs(sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1]))) / 2


def rings(geom):
    if geom["type"] == "Polygon":
        yield geom["coordinates"][0]
    elif geom["type"] == "MultiPolygon":
        for poly in geom["coordinates"]:
            yield poly[0]


def main():
    data = load(sys.argv[1] if len(sys.argv) > 1 else None)
    out = []
    for feat in data["features"]:
        for ring in rings(feat["geometry"]):
            pts = [(float(x), float(y)) for x, y in ring]
            if max(y for _, y in pts) < LAT[0] - 4 or area(pts) < MIN_AREA:
                continue
            if pts[0] == pts[-1]:
                pts = pts[:-1]
            pts = simplify(pts + [pts[0]], TOL)[:-1]
            q = []
            for x, y in pts:
                p = (round(x * Q), round(y * Q))
                if not q or p != q[-1]:
                    q.append(p)
            if len(q) < 3:
                continue
            flat = [q[0][0], q[0][1]]
            for (x0, y0), (x1, y1) in zip(q, q[1:]):
                flat += [x1 - x0, y1 - y0]
            out.append(flat)
    out.sort(key=len, reverse=True)
    text = json.dumps({"v": 1, "q": Q, "lat": LAT, "p": out}, separators=(",", ":"))
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(text)
    print(f"{len(out)} halka, {sum(len(r) // 2 for r in out)} nokta, {len(text) / 1024:.1f} KB → {os.path.normpath(OUT)}")


if __name__ == "__main__":
    main()
