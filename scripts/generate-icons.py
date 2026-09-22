from PIL import Image, ImageDraw, ImageChops
import os
import subprocess

os.makedirs('assets', exist_ok=True)
os.makedirs('public', exist_ok=True)
os.makedirs('src-tauri/icons', exist_ok=True)

# Load source ant logo
src = Image.open('assets/ant-logo-source.png').convert('RGBA')

# Crop to non-transparent bounding box
bbox = src.getbbox()
ant_cropped = src.crop(bbox)
w, h = ant_cropped.size

# 1. App Icon (1024x1024 master)
# Pure white background squircle, centered ant with NO padding (edge-to-edge), keeping original icon color
size = 1024
radius = int(size * 0.223)  # Apple standard squircle corner ratio (~228px on 1024)

app_icon = Image.new('RGBA', (size, size), (0, 0, 0, 0))
draw = ImageDraw.Draw(app_icon)
draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=(255, 255, 255, 255))

# Scale to fit canvas with 0 padding (touching top/bottom or left/right edge)
scale = float(size) / max(w, h)
nw, nh = int(round(w * scale)), int(round(h * scale))
ant_resized = ant_cropped.resize((nw, nh), Image.Resampling.LANCZOS)
ox = (size - nw) // 2
oy = (size - nh) // 2

ant_layer = Image.new('RGBA', (size, size), (0, 0, 0, 0))
ant_layer.paste(ant_resized, (ox, oy))
app_icon = Image.alpha_composite(app_icon, ant_layer)

# Mask any bleed strictly to the squircle
squircle_mask = Image.new('L', (size, size), 0)
mask_draw = ImageDraw.Draw(squircle_mask)
mask_draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
r, g, b, a = app_icon.split()
a = ImageChops.multiply(a, squircle_mask)
app_icon.putalpha(a)

app_icon.save('assets/icon.png')

# 2. Status bar / Tray icons
# Keep icon color on transparent background (alpha 0)
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
    tw, th = max(1, int(round(w * t_scale))), max(1, int(round(h * t_scale)))
    scaled_icon = ant_cropped.resize((tw, th), Image.Resampling.LANCZOS)
    
    tray_canvas = Image.new('RGBA', (target_w, target_h), (0, 0, 0, 0))
    pos_x = (target_w - tw) // 2
    pos_y = (target_h - th) // 2
    tray_canvas.paste(scaled_icon, (pos_x, pos_y), scaled_icon)
    tray_canvas.save(out_path)

# 3. Browser favicon and Windows ICO
fav = app_icon.resize((64, 64), Image.Resampling.LANCZOS)
fav.save('public/favicon.png')
app_icon_256 = app_icon.resize((256, 256), Image.Resampling.LANCZOS)
app_icon_256.save('public/app-icon.png')
if os.path.exists('dist'):
    fav.save('dist/favicon.png')
    app_icon_256.save('dist/app-icon.png')

app_icon.save('assets/icon.ico', format='ICO', sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])

print("Running tauri icon generator for bundle assets...")
subprocess.run(['npx', 'tauri', 'icon', 'assets/icon.png', '-o', 'src-tauri/icons'], check=True)

# Re-save tray-icon.png in case tauri icon altered it or touched it
for target_w, target_h, out_path in [(44, 44, 'src-tauri/icons/tray-icon.png')]:
    margin = 2
    inner_dim = target_w - margin * 2
    t_scale = float(inner_dim) / max(w, h)
    tw, th = max(1, int(round(w * t_scale))), max(1, int(round(h * t_scale)))
    scaled_icon = ant_cropped.resize((tw, th), Image.Resampling.LANCZOS)
    tray_canvas = Image.new('RGBA', (target_w, target_h), (0, 0, 0, 0))
    pos_x = (target_w - tw) // 2
    pos_y = (target_h - th) // 2
    tray_canvas.paste(scaled_icon, (pos_x, pos_y), scaled_icon)
    tray_canvas.save(out_path)

print("All termi icons successfully generated!")
