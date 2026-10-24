#!/usr/bin/env python3
"""Download CC0 assets: Poly Haven (textures, HDRI, models) + Quaternius (poly.pizza) soldier model.
Usage: python3 scripts/fetch-assets.py   (skips files already downloaded)
License: all CC0 (public domain). See THIRD_PARTY_NOTICES.md for the list."""
import json, os, subprocess

ROOT = os.path.join(os.path.dirname(__file__), '..', 'public', 'assets')
TEXTURES = ['dirt_floor', 'sparse_grass', 'rocky_terrain_02', 'rock_face_03', 'plastered_wall_04', 'red_brick_03',
            'concrete_wall_008', 'asphalt_02', 'bark_brown_02', 'wood_planks_grey', 'corrugated_iron_02']
MODELS = ['boulder_01', 'rock_07', 'concrete_road_barrier', 'wooden_military_crate', 'Barrel_01', 'covered_car',
          'ammo_box', 'medical_box', 'shrub_02']
HDRI = ('kloofendal_48d_partly_cloudy_puresky', '2k')
EXTRA = {'models/soldier.glb': 'https://static.poly.pizza/1083c1d3-d1d4-4682-adf6-bc516d06ac84.glb'}

def get(url, dest):
    dest = os.path.join(ROOT, dest)
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    subprocess.run(['curl', '-sSfL', '-A', 'polyzone-asset-fetch', '-o', dest, url], check=True)
    print('  ', os.path.relpath(dest, ROOT), os.path.getsize(dest) // 1024, 'KB')

def files(asset):
    out = subprocess.run(['curl', '-sSfL', '-A', 'polyzone-asset-fetch', f'https://api.polyhaven.com/files/{asset}'], check=True, capture_output=True)
    return json.loads(out.stdout)

for t in TEXTURES:
    f = files(t)
    for key, short in (('Diffuse', 'diff'), ('nor_gl', 'nor'), ('Rough', 'rough')):
        get(f[key]['1k']['jpg']['url'], f'textures/{t}/{short}.jpg')
f = files(HDRI[0])
get(f['hdri'][HDRI[1]]['hdr']['url'], f'hdri/{HDRI[0]}.hdr')
for m in MODELS:
    g = files(m)['gltf']['1k']['gltf']
    get(g['url'], f'models/{m}/{m}.gltf')
    for rel, inc in g['include'].items():
        get(inc['url'], f'models/{m}/{rel}')
for dest, url in EXTRA.items():
    get(url, dest)
print('done')
