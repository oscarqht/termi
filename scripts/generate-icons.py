from PIL import Image, ImageDraw
import os
import subprocess

os.makedirs('assets', exist_ok=True)
os.makedirs('public', exist_ok=True)
os.makedirs('src-tauri/icons', exist_ok=True)

# Load source ant logo
src = Image.open('assets/ant-logo-source.png').convert('RGBA')

# Crop to non-transparent bounding box
bbox = src.getbbox()  # (151, 147, 873, 909)
ant_cropped = src.crop(bbox)
w, h = ant_cropped.size
_, _, _, a = ant_cropped.split()

# 1. App Icon (1024x1024 master)
# Pure white squircle with NO outline/grey padding, centered pure black ant
size = 1024
app_icon = Image.new('RGBA', (size, size), (0, 0, 0, 0))
draw = ImageDraw.Draw(app_icon)
radius = int(size * 0.223)  # Apple standard squircle corner ratio (~228px on 1024)
draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=(255, 255, 255, 255))

# Pure black ant: RGB = (0, 0, 0), with alpha channel preserved
black_ant = Image.merge('RGBA', (
    Image.new('L', (w, h), 0),
    Image.new('L', (w, h), 0),
    Image.new('L', (w, h), 0),
    a
))

scale = (size * 0.70) / max(w, h)
nw, nh = int(w * scale), int(h * scale)
ant_resized = black_ant.resize((nw, nh), Image.Resampling.LANCZOS)
ox = (size - nw) // 2
oy = (size - nh) // 2

ant_layer = Image.new('RGBA', (size, size), (0, 0, 0, 0))
ant_layer.paste(ant_resized, (ox, oy))
app_icon = Image.alpha_composite(app_icon, ant_layer)
app_icon.save('assets/icon.png')

# 2. Status bar / Tray icons
# Pure white ant (RGB 255, 255, 255) on transparent background (alpha 0)
sizes = [
    (18, 18, 'assets/iconTemplate.png'),
    (36, 36, 'assets/iconTemplate@2x.png'),
    (22, 22, 'assets/trayIcon.png'),
    (44, 44, 'assets/trayIcon@2x.png'),
    (16, 16, 'assets/trayIcon-16.png'),
    (32, 32, 'assets/trayIcon-32.png'),
    (44, 44, 'src-tauri/icons/tray-icon.png'),
]

for target_w, target_h, out_path in sizes:
    margin = 1 if target_w <= 22 else 2
    inner_dim = target_w - margin * 2
    t_scale = float(inner_dim) / max(w, h)
    tw, th = max(1, int(w * t_scale)), max(1, int(h * t_scale))
    a_scaled = a.resize((tw, th), Image.Resampling.LANCZOS)
    
    white_icon = Image.merge('RGBA', (
        Image.new('L', (tw, th), 255),
        Image.new('L', (tw, th), 255),
        Image.new('L', (tw, th), 255),
        a_scaled
    ))
    
    # Canvas with pure white RGB and transparent alpha so no dark edge fringing occurs
    tray_canvas = Image.new('RGBA', (target_w, target_h), (255, 255, 255, 0))
    pos_x = (target_w - tw) // 2
    pos_y = (target_h - th) // 2
    tray_canvas.paste(white_icon, (pos_x, pos_y), white_icon)
    tray_canvas.save(out_path)

# 3. Browser favicon and Windows ICO
fav = app_icon.resize((64, 64), Image.Resampling.LANCZOS)
fav.save('public/favicon.png')
if os.path.exists('dist'):
    fav.save('dist/favicon.png')

app_icon.save('assets/icon.ico', format='ICO', sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])

print("Running tauri icon generator for bundle assets...")
subprocess.run(['npx', 'tauri', 'icon', 'assets/icon.png', '-o', 'src-tauri/icons'], check=True)

print("All icons successfully generated!")
