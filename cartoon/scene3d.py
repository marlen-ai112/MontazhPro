"""3D version of THE BOX: Blender (Cycles, CPU) driven by the same Director timeline as the 2D build.

usage:
  python3 scene3d.py stills OUTDIR t1 t2 ...        # quick previews
  python3 scene3d.py render FRAMEDIR [start end step] # render unique frames (resumable)
"""
import bpy, bmesh, math, sys, os, json, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import engine as E
from episode01 import build

S = 0.01
FPS = 24
G0 = E.GROUND


def clamp(v, a=0.0, b=1.0):
    return max(a, min(b, v))


# ------------------------------------------------------------------ materials
_mats = {}


def mat(name, color, rough=0.45, metal=0.0, emit=None, emit_strength=0.0, coat=0.0, sss=0.0, alpha=None):
    if name in _mats:
        return _mats[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if coat:
        b.inputs["Coat Weight"].default_value = coat
    if sss:
        b.inputs["Subsurface Weight"].default_value = sss
        b.inputs["Subsurface Radius"].default_value = (0.6, 0.25, 0.15)
    if emit is not None:
        b.inputs["Emission Color"].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = emit_strength
    _mats[name] = m
    return m


def cardboard(name, base, var, wave=True, scale=3.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = 0.85
    tc = nt.nodes.new("ShaderNodeTexCoord")
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = scale
    noise.inputs["Detail"].default_value = 6
    nt.links.new(tc.outputs["Object"], noise.inputs["Vector"])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (*base, 1)
    ramp.color_ramp.elements[1].color = (*var, 1)
    nt.links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], b.inputs["Base Color"])
    if wave:
        w = nt.nodes.new("ShaderNodeTexWave")
        w.wave_type = "BANDS"
        w.bands_direction = "X"
        w.inputs["Scale"].default_value = 14
        w.inputs["Distortion"].default_value = 1.2
        nt.links.new(tc.outputs["Object"], w.inputs["Vector"])
        bump = nt.nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = 0.35
        nt.links.new(w.outputs["Fac"], bump.inputs["Height"])
        nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    return m


def striped(name, color, dark, scale=60):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = 0.6
    tc = nt.nodes.new("ShaderNodeTexCoord")
    w = nt.nodes.new("ShaderNodeTexWave")
    w.wave_type = "BANDS"
    w.bands_direction = "Z"
    w.inputs["Scale"].default_value = scale
    nt.links.new(tc.outputs["Object"], w.inputs["Vector"])
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.6
    nt.links.new(w.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    return m


# ------------------------------------------------------------------ primitives
def prim(kind, parent=None, loc=(0, 0, 0), scale=(1, 1, 1), rot=(0, 0, 0), m=None, bevel=0.0, smooth=True, **kw):
    if kind == "sphere":
        bpy.ops.mesh.primitive_uv_sphere_add(radius=1, segments=32, ring_count=18)
    elif kind == "cube":
        bpy.ops.mesh.primitive_cube_add(size=1)
    elif kind == "cyl":
        bpy.ops.mesh.primitive_cylinder_add(radius=1, depth=1, vertices=40)
    elif kind == "cone":
        bpy.ops.mesh.primitive_cone_add(radius1=1, radius2=kw.get("r2", 0), depth=1, vertices=32)
    elif kind == "torus":
        bpy.ops.mesh.primitive_torus_add(major_radius=1, minor_radius=kw.get("minor", 0.12), major_segments=48, minor_segments=16)
    elif kind == "plane":
        bpy.ops.mesh.primitive_plane_add(size=1)
    o = bpy.context.object
    o.scale = scale
    o.rotation_euler = rot
    if parent is not None:
        o.parent = parent
    o.location = loc
    if m is not None:
        o.data.materials.append(m)
    if bevel > 0:
        bpy.ops.object.select_all(action="DESELECT")
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        md = o.modifiers.new("bv", "BEVEL")
        md.width = bevel
        md.segments = 4
        md.limit_method = "ANGLE"
        bpy.ops.object.modifier_apply(modifier="bv")
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(50))
    elif smooth and kind != "plane":
        o.data.polygons.foreach_set("use_smooth", [True] * len(o.data.polygons))
    return o


def empty(parent=None, loc=(0, 0, 0)):
    o = bpy.data.objects.new("e", None)
    bpy.context.collection.objects.link(o)
    if parent is not None:
        o.parent = parent
    o.location = loc
    return o


HIDE = 1e-4


def setvis(o, on, scale=(1, 1, 1)):
    o.scale = scale if on else (HIDE, HIDE, HIDE)


# ------------------------------------------------------------------ characters
WHITE = lambda: mat("eyewhite", (0.97, 0.97, 0.97), 0.25)
BLACK = lambda: mat("pupil", (0.02, 0.02, 0.03), 0.15, coat=1.0)
GLINT = lambda: mat("glint", (1, 1, 1), 0.1, emit=(1, 1, 1), emit_strength=4.0)
MOUTHM = lambda: mat("mouth", (0.18, 0.03, 0.05), 0.5)
TONGUE = lambda: mat("tongue", (0.85, 0.3, 0.35), 0.5)


class Rig:
    def __init__(self, act, h, surf, eyes, mouth, brow_col, eye_ry=1.15, mw_scale=1.0):
        self.act = act
        self.h = h
        self.surf = surf
        self.ex, self.ez, self.er = eyes
        self.mx, self.mz, self.mw = mouth
        self.root = empty()
        self.piv = empty(self.root, (0, 0, h / 2))
        self.eye_ry = eye_ry
        self.brow_col = brow_col
        self.sparks = []

    def P(self, kind, loc, scale=(1, 1, 1), rot=(0, 0, 0), m=None, parent=None, **kw):
        if parent is None:
            parent = self.piv
            loc = (loc[0], loc[1], loc[2] - self.h / 2)
        return prim(kind, parent, loc, scale, rot, m, **kw)

    def build_face(self):
        er = self.er
        self.eyes, self.pup, self.gl, self.brows = [], [], [], []
        bm = mat("brow_" + self.act.name, self.brow_col, 0.6)
        for sgn in (-1, 1):
            x = sgn * self.ex
            y = self.surf(x, self.ez) - er * 0.12
            self.eyes.append(self.P("sphere", (x, y, self.ez), (er, er * 0.38, er * self.eye_ry), m=WHITE()))
            self.pup.append(self.P("sphere", (x, y - er * 0.3, self.ez), (er * 0.5, er * 0.2, er * 0.5), m=BLACK()))
            self.gl.append(self.P("sphere", (x, y - er * 0.5, self.ez), (er * 0.14, er * 0.06, er * 0.14), m=GLINT()))
            self.brows.append(self.P("cyl", (x, y, self.ez + er * 1.55), (er * 0.14, er * 0.14, er * 1.9), (0, math.pi / 2, 0), m=bm))
        self.mouth_open = self.P("sphere", (self.mx, self.surf(self.mx, self.mz) - 0.02, self.mz), (self.mw, 0.05, 0.1), m=MOUTHM())
        self.tongue = self.P("sphere", (self.mx, self.surf(self.mx, self.mz) - 0.05, self.mz), (self.mw * 0.5, 0.03, 0.05), m=TONGUE())
        # mouth line (poly curve with bevel)
        cu = bpy.data.curves.new("mouth_" + self.act.name, "CURVE")
        cu.dimensions = "3D"
        cu.bevel_depth = 0.028
        cu.bevel_resolution = 3
        cu.use_fill_caps = True
        sp = cu.splines.new("POLY")
        sp.points.add(8)
        self.line_sp = sp
        o = bpy.data.objects.new("mline", cu)
        bpy.context.collection.objects.link(o)
        o.parent = self.piv
        o.data.materials.append(MOUTHM())
        self.line = o

    def face_update(self, st, t):
        ba, bl, eo, smile, mwid, ps = st["mood"]
        er = self.er
        blink = 0.0
        if not st["freeze"]:
            per = 3.1 + self.act.seed * 2.2
            ph = (t + self.act.seed * 9) % per
            if ph < 0.15:
                blink = math.sin(math.pi * ph / 0.15)
        lx, ly = st["lx"], st["ly"]
        if lx > 1e5:
            dx = dy = 0.0
        else:
            vx, vy = lx - st["x"], ly - (st["y"] - 100 * st["s"])
            d = math.hypot(vx, vy) + 1e-6
            k = min(1.0, d / 260.0)
            dx, dy = vx / d * k, vy / d * k
        ry = er * self.eye_ry * eo * (1 - 0.92 * blink)
        ang = math.atan(ba * 0.025)
        h = self.h
        for i, sgn in enumerate((-1, 1)):
            x = sgn * self.ex
            y = self.surf(x, self.ez) - er * 0.12
            self.eyes[i].scale = (er, er * 0.38, max(ry, 0.004))
            pr = er * 0.52 * ps
            px = x + dx * (er - pr) * 0.85
            pz = self.ez - dy * max(ry - pr, 0) * 0.85
            vis = blink < 0.7
            self.pup[i].location = (px, self.surf(px, pz) - er * 0.30, pz - h / 2)
            self.pup[i].scale = (pr, er * 0.2, min(pr, ry * 0.95)) if vis else (HIDE,) * 3
            self.gl[i].location = (px - pr * 0.3, self.surf(px, pz) - er * 0.52, pz + pr * 0.35 - h / 2)
            self.gl[i].scale = (er * 0.14, er * 0.06, er * 0.14) if vis else (HIDE,) * 3
            bz = self.ez + er * 1.55 - bl * er / 20.0
            self.brows[i].location = (x - sgn * er * 0.05, y - er * 0.1, bz - h / 2)
            self.brows[i].rotation_euler = (0, math.pi / 2 - (ang if sgn < 0 else -ang) * -1 * -1 + 0, 0)
            self.brows[i].rotation_euler = (0, math.pi / 2 + (ang if sgn < 0 else -ang), 0)
        # mouth
        w = self.mw * mwid
        mz = self.mz
        open_v = st["talk"]
        cyc = mz + smile * 0.2 * w
        if open_v < 0.07:
            setvis(self.mouth_open, False)
            setvis(self.tongue, False)
            self.line.hide_render = False
            pts = self.line_sp.points
            for i in range(9):
                u = i / 8
                x = self.mx + (-w + 2 * w * u)
                z = (1 - u) ** 2 * cyc + 2 * u * (1 - u) * (mz - smile * 0.62 * w) + u * u * cyc
                pts[i].co = (x, self.surf(x, z) - 0.03, z - h / 2, 1)
        else:
            self.line.hide_render = True
            hh = open_v * w * 0.95
            zc = cyc - hh * 0.8
            self.mouth_open.location = (self.mx, self.surf(self.mx, zc) - 0.02, zc - h / 2)
            self.mouth_open.scale = (w * 0.9, 0.05, max(hh * 0.85, 0.03))
            self.tongue.location = (self.mx, self.surf(self.mx, zc) - 0.05, zc - hh * 0.35 - h / 2)
            self.tongue.scale = (w * 0.5, 0.03, max(hh * 0.3, 0.01))

    def update(self, st, t):
        h = self.h
        x, y, s = st["x"], st["y"], st["s"]
        z = (G0 - (y + st["dy"])) * S
        zf = (G0 - y) * S
        depth = 1.2 * clamp(zf / 1.8)
        vis = st["vis"] >= 0.5
        idle = 0.0 if st["freeze"] else math.sin(2 * math.pi * (t * 0.55 + self.act.seed)) * 0.018
        sx = s * st["sqx"] * (1 - idle * 0.5)
        sz = s * st["sqy"] * (1 + idle)
        self.root.location = (x * S, depth, z)
        self.root.scale = (sx, sx, sz) if vis else (HIDE,) * 3
        self.piv.rotation_euler = (0, math.radians(st["rot"]), 0)
        self.face_update(st, t)
        self.extra(st, t)

    def extra(self, st, t):
        pass


def surf_flat(y):
    return lambda x, z: y


def surf_sphere(r, cz):
    def f(x, z):
        v = r * r - x * x - (z - cz) ** 2
        return -math.sqrt(max(v, 0.0001))
    return f


def surf_cyl(r):
    return lambda x, z: -math.sqrt(max(r * r - x * x, 0.0001))


def make_kubik(act):
    r = Rig(act, 1.5, surf_flat(-0.5), (0.34, 0.64, 0.20), (0, 0.26, 0.23), (0.15, 0.03, 0.03))
    red = mat("red", (0.75, 0.035, 0.04), 0.28, coat=0.5)
    r.P("cube", (0, 0, 0.55), (2.0, 1.0, 1.1), m=red, bevel=0.05)
    for j, yy in enumerate((-0.25, 0.25)):
        for i in range(4):
            x = -0.75 + 0.5 * i
            if j == 0 and i == 2:
                r.P("cyl", (x, yy, 1.105), (0.17, 0.17, 0.02), m=mat("hole", (0.01, 0.0, 0.0), 0.8))
                r.P("torus", (x, yy, 1.12), (0.17, 0.17, 0.17), m=red, minor=0.07)
                continue
            r.P("cyl", (x, yy, 1.18), (0.18, 0.18, 0.17), m=red, bevel=0.025)
    r.build_face()
    return r


def make_lime(act):
    R = 0.88
    r = Rig(act, 1.76, surf_sphere(R, 0.88), (0.28, 0.96, 0.22), (0, 0.48, 0.27), (0.1, 0.12, 0.02), eye_ry=1.1)
    m = bpy.data.materials.new("limeskin")
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = 0.38
    b.inputs["Subsurface Weight"].default_value = 0.25
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 90
    tc = nt.nodes.new("ShaderNodeTexCoord")
    nt.links.new(tc.outputs["Object"], noise.inputs["Vector"])
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.25
    nt.links.new(noise.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    r.lime_bsdf = b
    r.bump = bump
    r.P("sphere", (0, 0, R), (R, R, R), m=m)
    r.P("sphere", (0, 0, 1.74), (0.07, 0.07, 0.04), m=mat("stem", (0.3, 0.25, 0.08), 0.8))
    dark = mat("spot", (0.16, 0.09, 0.03), 0.8)
    r.spots = []
    for (sx, sz, sr) in ((52, 0.96 - 0.62 + 0.62 - 0.35, 15), (-56, 0.5, 12), (30, 0.7, 10), (-40, 1.5, 9), (62, 1.1, 8), (0, 0.2, 7)):
        pass
    SP = [(0.52, 0.62, 0.15), (-0.56, 0.74, 0.12), (0.3, 1.02, 0.10), (-0.4, 0.3, 0.09), (0.62, 0.2, 0.08), (0.0, 1.5, 0.07)]
    for (x, z, rad) in SP:
        o = r.P("sphere", (x, surf_sphere(R, 0.88)(x, z) + 0.02, z), (rad, 0.03, rad * 0.8), m=dark)
        r.spots.append((o, rad, x, z))
    r.build_face()

    def extra(st, t):
        age = st["a"]

        def lerp(a, b, u):
            u = clamp(u)
            return tuple(a[i] + (b[i] - a[i]) * u for i in range(3))
        base = lerp((0.22, 0.62, 0.05), (0.42, 0.38, 0.08), age * 1.2)
        base = lerp(base, (0.18, 0.1, 0.03), (age - 0.55) * 1.6)
        r.lime_bsdf.inputs["Base Color"].default_value = (*base, 1)
        r.bump.inputs["Strength"].default_value = 0.25 + age * 1.2
        ns = 0 if age < 0.03 else 1 + int(age * 12)
        for i, (o, rad, x, z) in enumerate(r.spots):
            if i < ns:
                k = clamp((age - 0.03) * 30) if ns == 1 else 1.0
                o.scale = (rad * k + 1e-4, 0.03, rad * 0.8 * k + 1e-4)
            else:
                o.scale = (HIDE,) * 3
        r.piv.rotation_euler = (0, math.radians(st["rot"]), math.radians(0))
    r.extra = extra
    r.roll_obj = None
    return r


def make_tiktak(act):
    r = Rig(act, 2.9, surf_flat(-0.37), (0.36, 1.60, 0.20), (0, 1.0, 0.24), (0.55, 0.55, 0.55))
    gold = mat("gold", (0.8, 0.55, 0.15), 0.3, metal=0.9)
    cream = mat("cream", (0.97, 0.93, 0.82), 0.5)
    r.P("cyl", (0, 0, 1.35), (1.2, 1.2, 0.7), (math.pi / 2, 0, 0), m=gold)
    r.P("torus", (0, -0.34, 1.35), (1.12, 1.12, 1.12), (math.pi / 2, 0, 0), m=gold, minor=0.1)
    r.P("cyl", (0, -0.34, 1.35), (0.98, 0.98, 0.06), (math.pi / 2, 0, 0), m=cream)
    dk = mat("hand", (0.28, 0.17, 0.1), 0.5)
    for i in range(12):
        a = math.radians(i * 30)
        rr = 0.88
        r.P("cube", (math.sin(a) * rr, -0.39, 1.35 + math.cos(a) * rr), (0.05, 0.03, 0.14 if i % 3 == 0 else 0.09), (0, a, 0), m=dk)
    for ang, ln, wd in ((3 * 30 + 47 * 0.5, 0.52, 0.08), (47 * 6, 0.78, 0.05)):
        a = math.radians(ang)
        r.P("cube", (math.sin(a) * ln / 2, -0.40, 1.35 + math.cos(a) * ln / 2), (wd, 0.02, ln), (0, a, 0), m=dk)
    # bells
    silver = mat("bell", (0.85, 0.78, 0.55), 0.25, metal=1.0)
    r.bells = []
    for sgn in (-1, 1):
        piv = empty(r.piv, (sgn * 0.78, 0, 2.46 - 1.45))
        piv.rotation_euler = (0, math.radians(sgn * 32), 0)
        b = prim("sphere", piv, (0, 0, 0.1), (0.52, 0.52, 0.42), m=silver)
        prim("sphere", piv, (0, 0, 0.46), (0.09, 0.09, 0.07), m=gold)
        r.bells.append((piv, sgn))
    r.P("cyl", (0, 0, 2.7), (0.03, 0.03, 0.35), m=dk)
    r.P("sphere", (0, 0, 2.88), (0.09, 0.09, 0.09), m=dk)
    for sgn in (-1, 1):
        r.P("cone", (sgn * 0.74, -0.1, 0.12), (0.2, 0.3, 0.24), (0, 0, 0), m=dk)
        for k in (-1, 1):
            pass
    mm = mat("mous", (0.38, 0.35, 0.35), 0.7)
    for sgn in (-1, 1):
        r.P("sphere", (sgn * 0.28, -0.41, 1.17), (0.3, 0.06, 0.06), (0, sgn * -0.3, 0), m=mm)
    r.build_face()

    def extra(st, t):
        ring = math.sin(t * 90) * 5 * st["a"] if st["a"] > 0 else 0
        for piv, sgn in r.bells:
            piv.rotation_euler = (0, math.radians(sgn * (32 + ring)), 0)
    r.extra = extra
    return r


def make_tsap(act):
    r = Rig(act, 2.7, surf_sphere(0.64, 1.40), (0.26, 1.50, 0.19), (0, 1.08, 0.24), (0.06, 0.08, 0.15))
    blue = mat("tsblue", (0.12, 0.2, 0.62), 0.3, coat=0.6)
    plastic = mat("tsblade", (0.7, 0.78, 0.92), 0.22, coat=0.8)
    r.P("sphere", (0, 0, 1.4), (0.64, 0.4, 0.64), m=blue)
    r.blades = []
    for sgn in (-1, 1):
        piv = empty(r.piv, (0, 0, 1.4 - 1.35))
        prim("cube", piv, (sgn * 0.02, 0, 0.7), (0.3, 0.1, 1.3), m=plastic, bevel=0.05)
        prim("sphere", piv, (sgn * 0.02, 0, 1.34), (0.15, 0.05, 0.12), m=plastic)
        r.blades.append((piv, sgn))
    for sgn, c in ((-1, (0.95, 0.4, 0.05)), (1, (0.12, 0.55, 0.22))):
        r.P("torus", (sgn * 0.48, 0, 0.62), (0.42, 0.42, 0.48), (math.pi / 2, 0, math.radians(sgn * 8)), m=mat("tsh%d" % sgn, c, 0.3, coat=0.5), minor=0.11)
    r.build_face()

    def extra(st, t):
        snip = st["a"] + st["talk"] * 0.8
        ang = 7 + 17 * snip
        for piv, sgn in r.blades:
            piv.rotation_euler = (0, math.radians(sgn * ang), 0)
    r.extra = extra
    return r


def make_tisha(act):
    r = Rig(act, 1.04, surf_flat(-0.11), (0.19, 0.62, 0.13), (0, 0.33, 0.13), (0.5, 0.42, 0.55))
    pearl = bpy.data.materials.new("pearl")
    pearl.use_nodes = True
    b = pearl.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.95, 0.93, 0.97, 1)
    b.inputs["Roughness"].default_value = 0.12
    b.inputs["Coat Weight"].default_value = 1.0
    try:
        b.inputs["Thin Film Thickness"].default_value = 500
        b.inputs["Thin Film IOR"].default_value = 1.6
    except Exception:
        pass
    r.P("cyl", (0, 0, 0.52), (0.52, 0.52, 0.2), (math.pi / 2, 0, 0), m=pearl, bevel=0.06)
    r.P("torus", (0, -0.09, 0.52), (0.5, 0.5, 0.5), (math.pi / 2, 0, 0), m=mat("rim", (0.75, 0.72, 0.8), 0.2, coat=1), minor=0.045)
    r.P("torus", (0.52, -0.02, 0.2), (0.12, 0.12, 0.12), (0, 0.3, 0), m=mat("thread", (0.9, 0.35, 0.5), 0.7), minor=0.03)
    r.build_face()
    return r


def make_iskra(act):
    r = Rig(act, 2.1, surf_cyl(0.5), (0.22, 1.30, 0.16), (0, 0.92, 0.15), (0.3, 0.17, 0.04))
    body = mat("bat", (0.9, 0.5, 0.08), 0.3, coat=0.6)
    r.P("cyl", (0, 0, 1.0), (0.5, 0.5, 1.84), m=body, bevel=0.1)
    r.P("cyl", (0, 0, 1.98), (0.26, 0.26, 0.14), m=mat("cap", (0.8, 0.8, 0.85), 0.25, metal=1.0), bevel=0.02)
    r.P("cyl", (0, 0, 0.3), (0.512, 0.512, 0.42), m=mat("band", (0.17, 0.15, 0.2), 0.4))
    r.P("cube", (0.32, -0.385, 1.12), (0.13, 0.04, 1.46), m=mat("gaugebg", (0.2, 0.12, 0.06), 0.5))
    r.P("cube", (0.32, -0.4, 0.82), (0.09, 0.04, 0.7), m=mat("gauge", (1, 0.85, 0.2), 0.3, emit=(1, 0.8, 0.1), emit_strength=0.8))
    r.build_face()
    sm = mat("spark", (1, 0.95, 0.5), 0.2, emit=(1, 0.9, 0.3), emit_strength=25)
    r.sparks = [r.P("cube", (0, -0.6, 1.3), (0.05, 0.04, 0.4), m=sm) for _ in range(9)]

    def extra(st, t):
        volt = st["a"]
        r.piv.location = (math.sin(t * 70) * 0.022 * volt, 0, 0)
        n = int(3 + volt * 7) if volt > 0.02 else 0
        for i, o in enumerate(r.sparks):
            ph = t * 11 + i * 1.37 + act.seed * 7
            on = i < n and (int(ph * 2) % 2 == 0 or volt > 0.8)
            if on:
                a = (int(ph * 2) * 2.1 + i * 1.9) % 6.283
                rr = 0.55 + 0.2 * volt + (i % 3) * 0.08
                o.location = (math.cos(a) * rr, -0.55, 1.3 + math.sin(a) * rr * 1.3 - r.h / 2)
                o.rotation_euler = (0, a + 1.57, 0)
                o.scale = (0.05, 0.04, 0.25 + 0.3 * volt)
            else:
                o.scale = (HIDE,) * 3
    r.extra = extra
    return r


MAKERS = dict(kubik=make_kubik, lime=make_lime, tiktak=make_tiktak, tsap=make_tsap, tisha=make_tisha, iskra=make_iskra)


# ------------------------------------------------------------------ hand
class Hand:
    def __init__(self):
        self.root = empty()
        skin = mat("skin", (1.0, 0.78, 0.64), 0.5, sss=0.3, emit=(1.0, 0.7, 0.55), emit_strength=0.35)
        self.skin = skin
        prim("cube", self.root, (0, 0, 0), (3.0, 0.9, 2.6), m=skin, bevel=0.5)
        prim("cyl", self.root, (0, 0, 10.8), (1.17, 1.17, 20), m=skin)
        self.fingers = []
        for fx, fa, fl in ((-1.1, -13, 2.15), (-0.38, -4, 2.55), (0.36, 5, 2.4), (1.06, 14, 1.9)):
            piv = empty(self.root, (fx, -0.05, -1.05))
            prim("cyl", piv, (0, 0, -fl / 2), (0.33, 0.33, fl), m=skin)
            prim("sphere", piv, (0, 0, -fl), (0.33, 0.33, 0.33), m=skin)
            prim("sphere", piv, (0, -0.2, -fl + 0.02), (0.18, 0.1, 0.22), m=mat("nail", (0.98, 0.8, 0.72), 0.25))
            self.fingers.append((piv, fx, fa, fl))
        self.thumb = empty(self.root, (1.35, -0.05, -0.2))
        prim("cyl", self.thumb, (0, 0, -0.95), (0.4, 0.4, 1.9), m=skin)
        prim("sphere", self.thumb, (0, 0, -1.9), (0.4, 0.4, 0.4), m=skin)

    def update(self, G, t):
        vis = G["hand_vis"].at(t) > 0.5
        hx, hy, cr = G["hand_x"].at(t), G["hand_y"].at(t), clamp(G["hand_curl"].at(t))
        self.root.location = (hx * S, -1.35, (G0 - hy) * S)
        self.root.scale = (1, 1, 1) if vis else (HIDE,) * 3
        for piv, fx, fa, fl in self.fingers:
            piv.location = (fx * (1 - 0.32 * cr), -0.05, -1.05)
            piv.rotation_euler = (math.radians(-cr * 62), 0, math.radians(-fa * (1 - 0.6 * cr)))
            piv.scale = (1, 1, 1 - 0.18 * cr)
        self.thumb.rotation_euler = (math.radians(-cr * 40), 0, math.radians(30 - 28 * cr))


# ------------------------------------------------------------------ environment
class Env:
    def __init__(self):
        paper = cardboard("wall", (0.5, 0.33, 0.19), (0.62, 0.43, 0.26))
        dark_paper = cardboard("wallside", (0.36, 0.23, 0.13), (0.44, 0.3, 0.18), scale=4)
        shelfm = cardboard("shelf", (0.72, 0.52, 0.32), (0.8, 0.6, 0.4), wave=False, scale=6)
        shelfside = cardboard("shelfside", (0.55, 0.38, 0.22), (0.66, 0.47, 0.28), scale=18)
        prim("cube", None, (10, 3.5, 6), (24, 1, 30), m=paper, smooth=False)
        prim("cube", None, (0.3, 0, 6), (1.0, 7, 40), m=dark_paper, smooth=False)
        prim("cube", None, (19.7, 0, 6), (1.0, 7, 40), m=dark_paper, smooth=False)
        prim("cube", None, (11.3, 0, -0.6), (16.0, 6.0, 1.2), m=shelfm, smooth=False)  # shelf x 3.3..19.3
        prim("cube", None, (11.3, -3.02, -0.7), (16.0, 0.05, 1.3), m=shelfside, smooth=False)
        prim("cube", None, (2.0, 0.5, -0.4), (3.0, 6.0, 0.8), m=mat("dark", (0.01, 0.008, 0.01), 0.9), smooth=False)
        prim("cube", None, (10, 2.2, -6.5), (24, 0.5, 10), m=mat("abyss", (0.012, 0.008, 0.012), 0.9), smooth=False)
        for i in range(5):  # forbidden stairs
            prim("cube", None, (1.8 + i * 0.35, 0.5, -0.3 - i * 0.2), (0.7, 3.0, 0.14), m=mat("step", (0.2, 0.12, 0.08), 0.8), smooth=False)
        # ceiling / attic void
        prim("cube", None, (10, 0, 14.5), (30, 12, 1), m=mat("attic", (0.01, 0.01, 0.015), 0.9), smooth=False)
        # lid flaps
        lidm = cardboard("lid", (0.3, 0.2, 0.12), (0.4, 0.28, 0.17), scale=5)
        self.flap = []
        for sgn in (-1, 1):
            piv = empty(None, (10 + sgn * 0.14, 0, 8.2))
            prim("cube", piv, (sgn * 5.0, 0.0, 0.5), (10.0, 5.0, 0.55), m=lidm, smooth=False)
            self.flap.append((piv, sgn))
        # emissive "outside" plane behind the hole
        self.sky_m = mat("sky", (1, 0.93, 0.75), 1, emit=(1, 0.93, 0.75), emit_strength=6)
        prim("plane", None, (10, 1.2, 11.5), (24, 1, 6), (math.pi / 2, 0, 0), m=self.sky_m, smooth=False)
        # light beam (fake volumetric)
        bm = bpy.data.materials.new("beam")
        bm.use_nodes = True
        nt = bm.node_tree
        for n in list(nt.nodes):
            nt.nodes.remove(n)
        em = nt.nodes.new("ShaderNodeEmission")
        tr = nt.nodes.new("ShaderNodeBsdfTransparent")
        mix = nt.nodes.new("ShaderNodeMixShader")
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        nt.links.new(tr.outputs[0], mix.inputs[1])
        nt.links.new(em.outputs[0], mix.inputs[2])
        nt.links.new(mix.outputs[0], out.inputs[0])
        mix.inputs[0].default_value = 0.0
        self.beam_mix = mix
        self.beam_em = em
        # beam geometry (trapezoid)
        me = bpy.data.meshes.new("beam")
        self.beam_me = me
        self.beam_obj = bpy.data.objects.new("beam", me)
        bpy.context.collection.objects.link(self.beam_obj)
        self.beam_obj.data.materials.append(bm)
        self.beam_obj.visible_shadow = False
        self.beam_obj.visible_camera = True
        # lights
        self.hole_light = self.add_area((10, 0.5, 7.9), 3, 200)
        self.hole_light.data.shape = "RECTANGLE"
        self.fill = self.add_area((10, -14, 6), 14, 300)
        self.fill.rotation_euler = (math.radians(90), 0, 0)
        self.rim = bpy.data.objects.new("rim", bpy.data.lights.new("rim", "AREA"))
        bpy.context.collection.objects.link(self.rim)
        self.rim.data.energy = 0
        # houses
        self.windows = []
        for cx, w, h, label, lit in ((640, 300, 210, (0.15, 0.4, 0.8), True), (960, 220, 170, (0.8, 0.2, 0.15), False),
                                     (1250, 200, 190, (0.2, 0.6, 0.3), True), (430, 210, 160, (0.95, 0.65, 0.12), False)):
            self.matchbox(cx * S, w * S, h * S, label, lit)
        self.lit_win = mat("winlit", (1, 0.85, 0.5), 0.5, emit=(1, 0.8, 0.4), emit_strength=0.3)
        self.dark_win = mat("windark", (0.4, 0.55, 0.65), 0.2, coat=1)
        self.tower(16.4)
        # props
        prim("sphere", None, (13.85, 0.5, 0.18), (0.18, 0.18, 0.18), m=mat("marble", (0.1, 0.3, 0.85), 0.05, coat=1))
        prim("cyl", None, (12.3, 0.45, 0.13), (0.09, 0.09, 1.0), (0, math.pi / 2, 0), m=mat("crayon", (0.85, 0.2, 0.55), 0.6))
        prim("cone", None, (12.88, 0.45, 0.13), (0.09, 0.09, 0.24), (0, math.pi / 2, 0), m=mat("crayon", (0.85, 0.2, 0.55), 0.6))
        prim("cyl", None, (3.42, 0.6, 0.65), (0.04, 0.04, 1.3), m=mat("post", (0.4, 0.27, 0.15), 0.7))
        prim("cube", None, (3.42, 0.55, 1.45), (1.2, 0.06, 0.65), m=mat("sign", (0.93, 0.93, 0.88), 0.5), bevel=0.04)
        prim("torus", None, (3.42, 0.5, 1.45), (0.22, 0.22, 0.22), (math.pi / 2, 0, 0), m=mat("signred", (0.85, 0.1, 0.1), 0.5), minor=0.05)
        prim("cube", None, (3.42, 0.5, 1.45), (0.5, 0.05, 0.07), (0, math.radians(-45), 0), m=mat("signred", (0.85, 0.1, 0.1), 0.5))
        for (x, z, r_) in ((4.0, 7.0, -6), (13.0, 8.0, 9)):
            prim("cube", None, (x, 2.9, z), (1.2, 0.03, 0.4), (0, math.radians(r_), 0), m=mat("tape", (0.93, 0.86, 0.62), 0.6), smooth=False)
        # world
        w = bpy.data.worlds.new("w")
        bpy.context.scene.world = w
        w.use_nodes = True
        self.bg = w.node_tree.nodes["Background"]

    def add_area(self, loc, size, energy):
        l = bpy.data.lights.new("a", "AREA")
        l.energy = energy
        l.size = size
        o = bpy.data.objects.new("a", l)
        bpy.context.collection.objects.link(o)
        o.location = loc
        return o

    def matchbox(self, cx, w, h, label, lit):
        woodm = cardboard("mbox", (0.82, 0.64, 0.42), (0.9, 0.72, 0.5), wave=False, scale=14)
        d = 1.6
        yc = 0.6 + d / 2
        e = empty(None, (cx, yc, 0))
        prim("cube", e, (0, 0, h / 2), (w, d, h), m=woodm, bevel=0.05)
        prim("cube", e, (w / 2 + 0.01, 0, h / 2), (0.05, d * 0.7, h * 0.7), m=mat("strike", (0.12, 0.1, 0.1), 0.9), smooth=False)
        prim("cube", e, (0, -d / 2 - 0.02, h - 0.38), (w - 0.2, 0.05, 0.48), m=mat("lab%d" % int(cx), label, 0.45), bevel=0.02)
        prim("cyl", e, (0, -d / 2 - 0.05, h - 0.38), (0.15, 0.15, 0.04), (math.pi / 2, 0, 0), m=mat("labdot", (0.95, 0.95, 0.95), 0.4))
        win = prim("cube", e, (-w / 2 + 0.56, -d / 2 - 0.03, h - 1.1), (0.56, 0.05, 0.5), m=mat("windark", (0.4, 0.55, 0.65), 0.2, coat=1))
        self.windows.append((win, lit, (cx - w / 2 + 0.56, 0.3, h - 1.1)))
        prim("cube", e, (w / 2 - 0.52, -d / 2 - 0.03, 0.5), (0.56, 0.05, 0.98), m=mat("door", (0.5, 0.33, 0.2), 0.6), bevel=0.02)
        prim("sphere", e, (w / 2 - 0.36, -d / 2 - 0.06, 0.5), (0.04, 0.04, 0.04), m=mat("knob", (0.9, 0.75, 0.3), 0.2, metal=1))

    def tower(self, cx):
        yc = 1.2
        e = empty(None, (cx, yc, 0))
        flange = mat("flange", (0.72, 0.5, 0.3), 0.55)
        for i, c in enumerate(((0.8, 0.2, 0.25), (0.2, 0.4, 0.8), (0.95, 0.75, 0.15))):
            z0 = i * 1.5
            prim("cyl", e, (0, 0, z0 + 0.09), (1.12, 1.12, 0.18), m=flange, bevel=0.03)
            prim("cyl", e, (0, 0, z0 + 1.41), (1.12, 1.12, 0.18), m=flange, bevel=0.03)
            prim("cyl", e, (0, 0, z0 + 0.75), (0.86, 0.86, 1.14), m=striped("thr%d" % i, c, c))

    def update(self, G, t, cam_x):
        night, lid, beam = G["night"].at(t), G["lid"].at(t), G["beam"].at(t)
        strength = max(beam, lid)
        hw = 0.14 + lid * 3.0
        for piv, sgn in self.flap:
            piv.location = (10 + sgn * hw, 0, 8.2)
            piv.rotation_euler = (0, math.radians(-sgn * lid * 22), 0)
        sky = (1, 0.93, 0.75) if night < 0.5 else (0.85, 0.9, 1.0)
        sky = tuple(sky[i] * (1 - night) + (0.7, 0.8, 1.0)[i] * night for i in range(3))
        sm = self.sky_m.node_tree.nodes["Principled BSDF"]
        sm.inputs["Emission Color"].default_value = (*sky, 1)
        sm.inputs["Emission Strength"].default_value = 14 * strength + 0.01
        sm.inputs["Base Color"].default_value = (*sky, 1)
        # hole light
        hl = self.hole_light
        hl.data.color = sky
        hl.data.energy = (900 * beam * (1 - 0.7 * night) + 5200 * lid) + 0.1
        hl.data.size = max(0.3, 2 * hw)
        hl.data.size_y = 2.2
        hl.location = (10, 0.9, 7.9)
        shift = 0.0 if lid > 0.3 else 0.35
        hl.rotation_euler = (math.radians(0), math.radians(180 - 0), 0) if False else (0, math.radians(-12 * (1 - lid) * (1 - 0)), 0)
        hl.rotation_euler = (math.radians(0), math.radians(-18 * (1 - lid)), 0)
        # beam mesh
        spread_top = hw
        spread_bot = hw + 0.9 + lid * 5.2
        sh = -2.4 if lid < 0.3 else -2.4 * (1 - lid * 0.6)
        verts = [(10 - spread_top, 1.0, 7.95), (10 + spread_top, 1.0, 7.95), (10 + sh + spread_bot, 1.0, 0.0), (10 + sh - spread_bot, 1.0, 0.0),
                 (10 - spread_top, -0.4, 7.95), (10 + spread_top, -0.4, 7.95), (10 + sh + spread_bot, -0.4, 0.0), (10 + sh - spread_bot, -0.4, 0.0)]
        self.beam_me.clear_geometry()
        self.beam_me.from_pydata(verts, [], [(0, 1, 2, 3), (4, 5, 6, 7), (0, 3, 7, 4), (1, 2, 6, 5)])
        self.beam_em.inputs["Color"].default_value = (*sky, 1)
        self.beam_em.inputs["Strength"].default_value = 1.0
        self.beam_mix.inputs[0].default_value = 0.16 * strength
        # fill light follows the camera
        self.fill.location = (cam_x, -14, 7)
        self.fill.data.energy = 700 * (1 - night) + 150 * night
        self.fill.data.size = 18
        self.fill.data.color = (1, 0.93, 0.85) if night < 0.5 else (0.6, 0.7, 1.0)
        # ambient
        d, n = (0.42, 0.33, 0.24), (0.03, 0.04, 0.09)
        self.bg.inputs["Color"].default_value = (*[d[i] * (1 - night) + n[i] * night for i in range(3)], 1)
        self.bg.inputs["Strength"].default_value = 1.0
        # windows
        for (win, lit, pos) in self.windows:
            win.data.materials.clear()
            win.data.materials.append(self.lit_win if lit else self.dark_win)
        self.lit_win.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 0.3 + night * 5


# ------------------------------------------------------------------ scene
class Scene3D:
    def __init__(self, D, res=None, samples=None):
        res = res or (int(os.environ.get('RES_W', 960)), int(os.environ.get('RES_H', 540)))
        samples = samples or int(os.environ.get('SPP', 8))
        bpy.ops.wm.read_factory_settings(use_empty=True)
        sc = bpy.context.scene
        self.sc = sc
        sc.render.engine = "CYCLES"
        sc.cycles.device = "CPU"
        sc.cycles.samples = samples
        sc.cycles.use_denoising = True
        sc.cycles.denoiser = "OPENIMAGEDENOISE"
        sc.cycles.use_adaptive_sampling = True
        sc.cycles.adaptive_threshold = 0.05
        sc.cycles.max_bounces = 4
        sc.cycles.diffuse_bounces = 3
        sc.cycles.glossy_bounces = 2
        sc.cycles.transmission_bounces = 2
        sc.cycles.caustics_reflective = False
        sc.cycles.caustics_refractive = False
        sc.render.resolution_x, sc.render.resolution_y = res
        sc.render.resolution_percentage = 100
        sc.render.use_persistent_data = True
        sc.render.threads_mode = "AUTO"
        sc.view_settings.view_transform = "Khronos PBR Neutral"
        sc.render.image_settings.file_format = "PNG"
        sc.render.image_settings.color_mode = "RGB"
        self.D = D
        self.env = Env()
        self.rigs = {}
        for a in D.order:
            self.rigs[a.name] = MAKERS[a.kind](a)
        self.hand = Hand()
        cam = bpy.data.cameras.new("cam")
        cam.lens = 50
        cam.sensor_width = 36
        cam.clip_end = 200
        self.cam = bpy.data.objects.new("cam", cam)
        bpy.context.collection.objects.link(self.cam)
        self.cam.rotation_euler = (math.pi / 2, 0, 0)
        sc.camera = self.cam

    def set_time(self, t):
        D, G = self.D, self.D.G
        cx, cy, cz = G["cx"].at(t), G["cy"].at(t), G["cz"].at(t)
        sk = G["shake"].at(t)
        sx, sy = math.sin(t * 61) * sk * S, math.cos(t * 47) * sk * S
        dist = 17.78 / cz
        self.cam.location = (cx * S + sx, -dist, (G0 - cy) * S + sy)
        self.env.update(G, t, cx * S)
        for name, rig in self.rigs.items():
            st = rig.act.state(t)
            rig.update(st, t)
        self.hand.update(G, t)

    def signature(self, t):
        D, G = self.D, self.D.G
        sig = [round(G[k].at(t), 2) for k in ("cx", "cy", "cz", "night", "lid", "beam", "shake", "hand_x", "hand_y", "hand_curl", "hand_vis")]
        for a in D.order:
            st = a.state(t)
            sig.append(tuple(round(v, 2) if not isinstance(v, tuple) else tuple(round(w, 2) for w in v) for v in st.values()))
        return repr(sig)

    def render(self, t, path):
        self.set_time(t)
        self.sc.render.filepath = path
        bpy.ops.render.render(write_still=True)


def main():
    mode = sys.argv[1]
    D = build()
    scn = Scene3D(D)
    if mode == "stills":
        out = sys.argv[2]
        os.makedirs(out, exist_ok=True)
        for tt in sys.argv[3:]:
            t0 = time.time()
            scn.render(float(tt), f"{out}/s_{float(tt):06.1f}.png")
            print("t", tt, "took", round(time.time() - t0, 1), flush=True)
    elif mode == "render":
        out = sys.argv[2]
        os.makedirs(out, exist_ok=True)
        nf = int((D.end() + 1.5) * FPS)
        start = int(sys.argv[3]) if len(sys.argv) > 3 else 0
        end = int(sys.argv[4]) if len(sys.argv) > 4 else nf
        step = int(sys.argv[5]) if len(sys.argv) > 5 else 2
        mp = os.path.join(out, "map.json")
        mapping = json.load(open(mp)) if os.path.exists(mp) else {}
        last_sig, last_file = None, None
        t_start = time.time()
        done = 0
        for f in range(start, end, step):
            t = f / FPS
            path = os.path.join(out, f"f_{f:05d}.png")
            if D.G["fade"].at(t) > 0.999:
                mapping[str(f)] = "black"
                continue
            sig = scn.signature(t)
            if sig == last_sig and last_file:
                mapping[str(f)] = last_file
                continue
            if not os.path.exists(path):
                scn.render(t, path)
            last_sig, last_file = sig, path
            mapping[str(f)] = path
            done += 1
            if done % 10 == 0:
                json.dump(mapping, open(mp, "w"))
                el = time.time() - t_start
                print(f"frame {f}/{nf} rendered={done} elapsed={el:.0f}s", flush=True)
        json.dump(mapping, open(mp, "w"))
        print("render done", time.time() - t_start)


if __name__ == "__main__":
    main()
