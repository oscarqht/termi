from PIL import Image, ImageDraw
import os

os.makedirs('assets', exist_ok=True)
os.makedirs('public', exist_ok=True)

# Load source ant logo
src = Image.open('assets/ant-logo-source.png').convert('RGBA')

# Crop to non-transparent bounding box
bbox = src.getbbox()  # (151, 147, 873, 909)
ant_cropped = src.crop(bbox)
w, h = ant_cropped.size

# 1. Electron App Icon (512x512)
# White squircle with subtle border, centered black ant face
app_icon = Image.new('RGBA', (512, 512), (0, 0, 0, 0))
draw = ImageDraw.Draw(app_icon)
draw.rounded_rectangle([12, 12, 500, 500], radius=110, fill=(255, 255, 255, 255), outline=(228, 228, 231, 255), width=2)

scale = 360.0 / max(w, h)
nw, nh = int(w * scale), int(h * scale)
ant_resized = ant_cropped.resize((nw, nh), Image.Resampling.LANCZOS)
ox = (512 - nw) // 2
oy = (512 - nh) // 2
app_icon.paste(ant_resized, (ox, oy), ant_resized)
app_icon.save('assets/icon.png')

# 2. White color status bar icons
# Turn black pixels to pure white (255, 255, 255) while preserving alpha anti-aliasing
r, g, b, a = ant_cropped.split()
white_ant = Image.merge('RGBA', (
    Image.new('L', (w, h), 255),
    Image.new('L', (w, h), 255),
    Image.new('L', (w, h), 255),
    a
))

# Generate tray icons across standard sizes
sizes = [
    (18, 18, 'assets/iconTemplate.png'),
    (36, 36, 'assets/iconTemplate@2x.png'),
    (22, 22, 'assets/trayIcon.png'),
    (44, 44, 'assets/trayIcon@2x.png'),
    (16, 16, 'assets/trayIcon-16.png'),
    (32, 32, 'assets/trayIcon-32.png'),
]

for target_w, target_h, out_path in sizes:
    tray_canvas = Image.new('RGBA', (target_w, target_h), (0, 0, 0, 0))
    # Leave 1px margin on small sizes, 2px on larger sizes
    margin = 1 if target_w <= 22 else 2
    inner_dim = target_w - margin * 2
    t_scale = float(inner_dim) / max(w, h)
    tw, th = max(1, int(w * t_scale)), max(1, int(h * t_scale))
    scaled = white_ant.resize((tw, th), Image.Resampling.LANCZOS)
    pos_x = (target_w - tw) // 2
    pos_y = (target_h - th) // 2
    tray_canvas.paste(scaled, (pos_x, pos_y), scaled)
    tray_canvas.save(out_path)

# 3. Browser favicon
fav = app_icon.resize((64, 64), Image.Resampling.LANCZOS)
fav.save('public/favicon.png')

print("All icons successfully generated from new ant logo!")
