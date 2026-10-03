# DJI drone modellerini Blender'da üretir ve assets/models/<id>.glb olarak dışa aktarır.
# Çalıştırma: /Applications/Blender.app/Contents/MacOS/Blender -b --python tools/build_drones.py
#
# Eksenler (Blender): +X sağ, +Y ileri (burun), +Z yukarı. glTF'e çıkınca three.js'te -Z ileri, +Y yukarı olur.
# Çalışma zamanı için adlar: prop_0..3 (pervane, motor ekseninde döner), gimbal (kamera başı),
# malzeme "led_back" (yanıp söner). Ölçüler metre, pervaneler açık.
import math
import os

import bpy

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets", "models")
os.makedirs(OUT, exist_ok=True)


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


_mats = {}


def mat(name, rgb, rough=0.45, metal=0.0, emit=None, alpha=1.0):
    key = name
    if key in _mats:
        return _mats[key]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*rgb, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if emit:
        bsdf.inputs["Emission Color"].default_value = (*emit, 1)
        bsdf.inputs["Emission Strength"].default_value = 4.0
    _mats[key] = m
    return m


def srgb(h):
    h = h.lstrip("#")
    c = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((v + 0.055) / 1.055) ** 2.4 if v > 0.04045 else v / 12.92 for v in c)


def finish(obj, material, smooth=True):
    obj.data.materials.append(material)
    if smooth:
        for p in obj.data.polygons:
            p.use_smooth = True
    return obj


def apply_scale(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)


def rbox(name, size, loc, material, bevel=0.3, seg=4, rot=(0, 0, 0), subsurf=0):
    """Pahlı kutu. size=(x,y,z) metre; bevel = en küçük kenarın oranı."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    o.scale = size
    apply_scale(o)
    b = o.modifiers.new("bevel", "BEVEL")
    b.width = min(size) * bevel
    b.segments = seg
    b.limit_method = "NONE"
    if subsurf:
        s = o.modifiers.new("sub", "SUBSURF")
        s.levels = subsurf
        s.render_levels = subsurf
    return finish(o, material)


def cyl(name, r, h, loc, material, rot=(0, 0, 0), verts=24, bevel=0.0):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=h, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    if bevel:
        b = o.modifiers.new("bevel", "BEVEL")
        b.width = bevel
        b.segments = 2
    return finish(o, material, smooth=True)


def sphere(name, r, loc, material, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=16, ring_count=10)
    o = bpy.context.active_object
    o.name = name
    o.scale = scale
    apply_scale(o)
    return finish(o, material)


def beam(name, a, b, w, h, material):
    """a'dan b'ye uzanan pahlı kol (kesit w x h)."""
    ax, ay, az = a
    bx, by, bz = b
    dx, dy, dz = bx - ax, by - ay, bz - az
    L = math.sqrt(dx * dx + dy * dy + dz * dz)
    mid = ((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2)
    yaw = math.atan2(dx, dy)
    pitch = math.atan2(dz, math.hypot(dx, dy))
    o = rbox(name, (w, L, h), mid, material, bevel=0.35, seg=3)
    o.rotation_euler = (pitch, 0, -yaw)
    return o


def propeller(i, center, r, blade_mat, hub_mat, blades=2, ccw=True):
    """Motor üstünde pervane: kök noktası motor ekseninde (prop_i)."""
    parts = []
    for k in range(blades):
        ang = k * 2 * math.pi / blades
        bl = rbox(f"blade_{i}_{k}", (0.013 * r / 0.076 + 0.004, r * 0.92, 0.0022), (0, r * 0.5, 0), blade_mat, bevel=0.45, seg=2)
        bl.rotation_euler = (0, math.radians(14 if ccw else -14), 0)
        bpy.ops.object.select_all(action="DESELECT")
        bl.select_set(True)
        bpy.context.view_layer.objects.active = bl
        # konumu da uygula: köken göbekte kalsın, ikinci kanat göbek etrafında dönsün
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        bl.rotation_euler = (0, 0, ang)
        parts.append(bl)
    hub = cyl(f"hub_{i}", r * 0.09, 0.008, (0, 0, 0), blade_mat)  # tek malzeme = pervane başına tek çizim
    parts.append(hub)
    bpy.ops.object.select_all(action="DESELECT")
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = hub
    bpy.ops.object.convert(target="MESH")  # değiştiricileri uygula
    bpy.ops.object.join()
    prop = bpy.context.active_object
    prop.name = f"prop_{i}"
    prop.location = center
    return prop


def motor(i, loc, r, body_mat, bell_mat):
    cyl(f"motor_{i}", r, r * 1.3, (loc[0], loc[1], loc[2] - r * 0.4), body_mat, bevel=r * 0.15)
    cyl(f"bell_{i}", r * 0.92, r * 0.5, (loc[0], loc[1], loc[2] + r * 0.5), bell_mat, bevel=r * 0.1)


def quad(spec):
    """Katlanır kollu DJI quadcopter (Mini / Air / Mavic)."""
    c = spec
    shell = mat("shell", srgb(c["shell"]), rough=0.38)
    dark = mat("dark", srgb("#22252a"), rough=0.5)
    blade = mat("blade", srgb(c.get("blade", "#2a2c30")), rough=0.4)
    glass = mat("glass", srgb("#0b1118"), rough=0.05, metal=0.6)
    metal = mat("metal", srgb("#b6bbc1"), rough=0.3, metal=0.7)
    led_f = mat("led_front", (1, 0.05, 0.03), emit=(1, 0.05, 0.03))
    led_b = mat("led_back", (0.05, 1, 0.2), emit=(0.05, 1, 0.2))
    W, L, H = c["body"]
    # gövde: alt kabuk + üst kapak (hafif dar) + ön burun yuvarlatma
    rbox("body", (W, L, H), (0, 0, 0), shell, bevel=0.42, seg=5)
    rbox("top", (W * 0.82, L * 0.78, H * 0.35), (0, -L * 0.04, H * 0.5), shell, bevel=0.45, seg=4)
    rbox("top_dark", (W * 0.5, L * 0.35, H * 0.08), (0, -L * 0.12, H * 0.66), dark, bevel=0.4, seg=3)
    # ön sensör gözleri ve arka sensörler
    for sx in (-1, 1):
        cyl(f"eye_f{sx}", H * 0.1, 0.004, (sx * W * 0.18, L * 0.5, H * 0.12), glass, rot=(math.pi / 2, 0, 0))
        cyl(f"eye_b{sx}", H * 0.09, 0.004, (sx * W * 0.16, -L * 0.5, H * 0.1), glass, rot=(math.pi / 2, 0, 0))
    rbox("battery_line", (W * 1.01, L * 0.6, 0.002), (0, -L * 0.1, -H * 0.12), dark, bevel=0.4, seg=1)
    # kollar ve motorlar: ön kollar üstte, arka kollar altta (DJI katlanma düzeni)
    mr = c["motor_r"]
    pr = c["prop_r"]
    motors = [
        (1, (c["front"][0], c["front"][1], c["front"][2]), True),
        (0, (-c["front"][0], c["front"][1], c["front"][2]), False),
        (3, (c["rear"][0], c["rear"][1], c["rear"][2]), False),
        (2, (-c["rear"][0], c["rear"][1], c["rear"][2]), True),
    ]
    for idx, m, ccw in motors:
        front = m[1] > 0
        root = (math.copysign(W * 0.38, m[0]), L * (0.3 if front else -0.32), H * (0.2 if front else -0.25))
        beam(f"arm_{idx}", root, (m[0], m[1], m[2] - mr * 0.3), c["arm_w"], c["arm_h"], shell if c.get("arm_shell") else dark)
        motor(idx, m, mr, dark, metal)
        if front:
            sphere(f"led_{idx}", mr * 0.35, (m[0], m[1] + mr * 0.2, m[2] - mr * 1.3), led_f)
            # ön kol altı iniş ayağı/anten
            rbox(f"foot_{idx}", (mr * 0.5, mr * 0.8, c["leg"]), (m[0], m[1] - mr, m[2] - mr - c["leg"] / 2), dark, bevel=0.4, seg=2)
        else:
            sphere(f"led_{idx}", mr * 0.35, (m[0], m[1] - mr * 0.2, m[2] - mr * 1.3), led_b)
            rbox(f"foot_{idx}", (mr * 0.5, mr * 0.8, c["leg"] * 0.6), (m[0], m[1], m[2] - mr - c["leg"] * 0.3), dark, bevel=0.4, seg=2)
        propeller(idx, (m[0], m[1], m[2] + mr * 0.9), pr, blade, dark, ccw=ccw)
    # gimbal: boyunduruk + kamera başı + lens(ler); gimbal boşluğu (empty) altında
    bpy.ops.object.empty_add(type="PLAIN_AXES", location=(0, L * 0.5 + c["cam"][1] * 0.35, -H * 0.18))
    g = bpy.context.active_object
    g.name = "gimbal"
    parts = []
    cw, cl, ch = c["cam"]
    gx, gy, gz = g.location
    parts.append(rbox("yoke", (cw * 1.25, cl * 0.35, ch * 0.25), (gx, gy - cl * 0.35, gz + ch * 0.55), dark, bevel=0.4, seg=2))
    if c.get("round_cam"):
        parts.append(sphere("cam_head", ch * 0.62, (gx, gy, gz), dark, scale=(cw / ch, cl / ch, 1)))
    else:
        parts.append(rbox("cam_head", (cw, cl, ch), (gx, gy, gz), dark, bevel=0.35, seg=4))
    for k, (lx, lr) in enumerate(c["lenses"]):
        parts.append(cyl(f"lens_{k}", lr, 0.006, (gx + lx, gy + cl / 2 + 0.002, gz), glass, rot=(math.pi / 2, 0, 0), verts=32))
        parts.append(cyl(f"lens_ring_{k}", lr * 1.18, 0.004, (gx + lx, gy + cl / 2, gz), metal, rot=(math.pi / 2, 0, 0), verts=32))
    for p in parts:
        p.parent = g
        p.matrix_parent_inverse = g.matrix_world.inverted()


def neo():
    white = mat("shell", srgb("#e9eaec"), rough=0.4)
    guard = mat("guard", srgb("#c9ccd1"), rough=0.45)
    dark = mat("dark", srgb("#25282d"), rough=0.5)
    blade = mat("blade", srgb("#3a3d42"), rough=0.4)
    glass = mat("glass", srgb("#0b1118"), rough=0.05, metal=0.6)
    led_b = mat("led_back", (0.05, 1, 0.2), emit=(0.05, 1, 0.2))
    rbox("body", (0.06, 0.075, 0.034), (0, 0, 0), white, bevel=0.45, seg=5)
    rbox("top_dark", (0.03, 0.03, 0.004), (0, -0.01, 0.018), dark, bevel=0.4, seg=2)
    sphere("led_b", 0.003, (0, -0.038, 0.004), led_b)
    for i, (sx, sy) in enumerate([(-1, 1), (1, 1), (-1, -1), (1, -1)]):
        cx, cy = sx * 0.05, sy * 0.05
        bpy.ops.mesh.primitive_torus_add(major_radius=0.031, minor_radius=0.004, location=(cx, cy, 0.004))
        t = bpy.context.active_object
        t.name = f"guard_{i}"
        t.scale = (1, 1, 2.2)
        apply_scale(t)
        finish(t, guard)
        beam(f"strut_{i}", (sx * 0.02, sy * 0.022, 0), (cx - sx * 0.02, cy - sy * 0.02, 0.002), 0.006, 0.004, guard)
        cyl(f"motor_{i}", 0.006, 0.01, (cx, cy, 0), dark)
        propeller(i, (cx, cy, 0.007), 0.026, blade, dark, ccw=(sx * sy > 0))
    bpy.ops.object.empty_add(type="PLAIN_AXES", location=(0, 0.04, 0.0))
    g = bpy.context.active_object
    g.name = "gimbal"
    head = rbox("cam_head", (0.02, 0.012, 0.016), (0, 0.04, 0), dark, bevel=0.4, seg=3)
    lens = cyl("lens_0", 0.005, 0.003, (0, 0.047, 0), glass, rot=(math.pi / 2, 0, 0))
    for p in (head, lens):
        p.parent = g
        p.matrix_parent_inverse = g.matrix_world.inverted()


def inspire():
    shell = mat("shell", srgb("#8d9196"), rough=0.35)
    dark = mat("dark", srgb("#232529"), rough=0.5)
    carbon = mat("carbon", srgb("#151618"), rough=0.3, metal=0.2)
    blade = mat("blade", srgb("#1d1f22"), rough=0.35)
    glass = mat("glass", srgb("#0b1118"), rough=0.05, metal=0.6)
    metal = mat("metal", srgb("#b6bbc1"), rough=0.3, metal=0.7)
    led_f = mat("led_front", (1, 0.05, 0.03), emit=(1, 0.05, 0.03))
    led_b = mat("led_back", (0.05, 1, 0.2), emit=(0.05, 1, 0.2))
    rbox("body", (0.17, 0.3, 0.1), (0, 0, 0), shell, bevel=0.45, seg=5)
    rbox("nose", (0.12, 0.08, 0.07), (0, 0.17, -0.005), shell, bevel=0.5, seg=5)
    rbox("top_dark", (0.09, 0.16, 0.012), (0, -0.03, 0.052), dark, bevel=0.4, seg=3)
    for sx in (-1, 1):
        cyl(f"eye{sx}", 0.008, 0.004, (sx * 0.035, 0.212, 0.0), glass, rot=(math.pi / 2, 0, 0))
    # uçuş modunda yukarı kalkmış V kollar, uçlarda motor ve aşağı inen iniş ayağı
    for i, (sx, sy, ccw) in enumerate([(-1, 1, False), (1, 1, True), (-1, -1, True), (1, -1, False)]):
        root = (sx * 0.07, sy * 0.08, 0.02)
        tip = (sx * 0.3, sy * 0.25, 0.13)
        beam(f"arm_{i}", root, tip, 0.024, 0.024, carbon)
        cyl(f"motor_{i}", 0.022, 0.03, (tip[0], tip[1], tip[2] + 0.012), dark, bevel=0.003)
        cyl(f"bell_{i}", 0.02, 0.012, (tip[0], tip[1], tip[2] + 0.032), metal)
        sphere(f"led_{i}", 0.006, (tip[0], tip[1], tip[2] - 0.012), led_f if sy > 0 else led_b)
        foot = (tip[0] + sx * 0.07, tip[1] + sy * 0.05, -0.17)
        beam(f"leg_{i}", (tip[0], tip[1], tip[2] - 0.01), foot, 0.014, 0.014, carbon)
        rbox(f"pad_{i}", (0.03, 0.05, 0.01), foot, dark, bevel=0.4, seg=2)
        propeller(i, (tip[0], tip[1], tip[2] + 0.045), 0.19, blade, dark, ccw=ccw)
    bpy.ops.object.empty_add(type="PLAIN_AXES", location=(0, 0.13, -0.11))
    g = bpy.context.active_object
    g.name = "gimbal"
    parts = [
        rbox("yoke", (0.12, 0.03, 0.03), (0, 0.11, -0.07), dark, bevel=0.4, seg=2),
        rbox("cam_head", (0.09, 0.1, 0.08), (0, 0.13, -0.11), dark, bevel=0.3, seg=4),
        cyl("lens_0", 0.026, 0.05, (0, 0.2, -0.11), dark, rot=(math.pi / 2, 0, 0), verts=32),
        cyl("lens_glass", 0.022, 0.004, (0, 0.226, -0.11), glass, rot=(math.pi / 2, 0, 0), verts=32),
    ]
    for p in parts:
        p.parent = g
        p.matrix_parent_inverse = g.matrix_world.inverted()


QUADS = {
    "mini4": dict(shell="#a3a8ae", body=(0.088, 0.15, 0.058), front=(0.112, 0.082, 0.012), rear=(0.118, -0.09, -0.012),
                  motor_r=0.0125, prop_r=0.076, arm_w=0.016, arm_h=0.011, leg=0.016, cam=(0.034, 0.026, 0.03),
                  lenses=[(0, 0.009)]),
    "mini5": dict(shell="#8a8f96", body=(0.09, 0.155, 0.06), front=(0.114, 0.084, 0.012), rear=(0.12, -0.092, -0.012),
                  motor_r=0.013, prop_r=0.078, arm_w=0.016, arm_h=0.011, leg=0.016, cam=(0.04, 0.03, 0.034),
                  lenses=[(0, 0.012)]),
    "air3s": dict(shell="#4b4e54", body=(0.098, 0.17, 0.068), front=(0.128, 0.096, 0.014), rear=(0.134, -0.104, -0.014),
                  motor_r=0.015, prop_r=0.1, arm_w=0.019, arm_h=0.013, leg=0.02, cam=(0.05, 0.03, 0.036),
                  lenses=[(-0.011, 0.008), (0.011, 0.008)], arm_shell=True),
    "mavic4": dict(shell="#3d4045", body=(0.11, 0.2, 0.08), front=(0.15, 0.115, 0.016), rear=(0.156, -0.125, -0.016),
                   motor_r=0.017, prop_r=0.12, arm_w=0.021, arm_h=0.014, leg=0.022, cam=(0.062, 0.05, 0.05),
                   lenses=[(-0.014, 0.008), (0.014, 0.008), (0, 0.006)], round_cam=True, arm_shell=True),
}


def merge_static():
    """Hareketsiz parçaları tek nesnede birleştir (çizim çağrısı = malzeme sayısı).
    Pervaneler (prop_*) ve gimbal altındakiler ayrı kalır; gimbal parçaları kendi içinde birleşir."""
    gimbal = bpy.data.objects.get("gimbal")
    def apply_all(objs):
        bpy.ops.object.select_all(action="DESELECT")
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        bpy.ops.object.convert(target="MESH")
    def join(objs, name):
        if not objs:
            return None
        apply_all(objs)
        bpy.ops.object.select_all(action="DESELECT")
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        if len(objs) > 1:
            bpy.ops.object.join()
        o = bpy.context.active_object
        o.name = name
        return o
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    gparts = [o for o in meshes if gimbal and o.parent == gimbal]
    static = [o for o in meshes if not o.name.startswith("prop_") and o not in gparts]
    join(static, "frame")
    if gparts:
        g = join(gparts, "gimbal_cam")
        g.parent = gimbal
        g.matrix_parent_inverse = gimbal.matrix_world.inverted()


def export(name):
    merge_static()
    path = os.path.join(OUT, f"{name}.glb")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_apply=True,
        export_yup=True,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=7,
        export_draco_position_quantization=14,
        export_draco_normal_quantization=12,  # yüzeylerde kademelenme olmasın
        export_draco_texcoord_quantization=10,
    )
    tris = sum(len(o.data.polygons) for o in bpy.data.objects if o.type == "MESH")
    print("yazıldı", path, os.path.getsize(path), "nesne", sum(1 for o in bpy.data.objects if o.type == "MESH"), "yüz", tris)


for name, spec in QUADS.items():
    clear()
    _mats.clear()
    quad(spec)
    export(name)

clear()
_mats.clear()
neo()
export("neo")

clear()
_mats.clear()
inspire()
export("inspire3")
