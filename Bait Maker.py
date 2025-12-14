import tkinter as tk
from tkinter import filedialog, messagebox, ttk
import cv2
import numpy as np
import os
from PIL import Image, ImageTk

# --- CORE IMAGE PROCESSING LOGIC ---

# This function is used to create the initial pencil sketch.
def adjust_levels(image, lower_bound, upper_bound):
    lower_bound = np.clip(lower_bound, 0, 255)
    upper_bound = np.clip(upper_bound, 0, 255)
    if lower_bound >= upper_bound:
        return image
    lut = np.array([int(((i - lower_bound) / (upper_bound - lower_bound)) * 255) if lower_bound < i < upper_bound else (0 if i <= lower_bound else 255) for i in np.arange(256)], dtype=np.uint8)
    return cv2.LUT(image, lut)

def create_pencil_sketch_from_image(img, pencil_tip_size=20, range_param=-1.5):
    """Processes an already loaded OpenCV image object into a grayscale sketch."""
    if img is None:
        return None, "Invalid image object provided."

    gray_img = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    inverted_gray_img = 255 - gray_img
    
    kernel_size = int(pencil_tip_size)
    if kernel_size % 2 == 0:
        kernel_size += 1
    
    blurred_img = cv2.GaussianBlur(inverted_gray_img, (kernel_size, kernel_size), 0)
    inverted_blurred_img = 255 - blurred_img
    pencil_sketch = cv2.divide(gray_img, inverted_blurred_img, scale=256.0)

    contrast_factor = 20
    lower_bound = 0 - (range_param * contrast_factor)
    upper_bound = 255 + (range_param * contrast_factor)
    
    final_sketch = adjust_levels(pencil_sketch, lower_bound, upper_bound)
    return final_sketch, "Success"

# --- COLOR CLEARER LOGIC (from the second script) ---
def apply_color_clearer(src_img, target_color):
    """
    Takes a PIL RGBA image and a target RGB color, and returns a new PIL RGBA image
    that will appear transparent when placed on that target color.
    """
    src_arr = np.array(src_img).astype(np.float64)
    target_color = np.array(target_color, dtype=np.float64)
    Rf, Gf, Bf, Af = src_arr[:, :, 0], src_arr[:, :, 1], src_arr[:, :, 2], src_arr[:, :, 3]
    Rb, Gb, Bb = target_color[0], target_color[1], target_color[2]
    alpha_norm = Af / 255.0
    Rc = Rb * (1 - alpha_norm) + Rf * alpha_norm
    Gc = Gb * (1 - alpha_norm) + Gf * alpha_norm
    Bc = Bb * (1 - alpha_norm) + Bf * alpha_norm
    def get_min_alpha(Cc, Cb):
        Ac = np.zeros_like(Cc, dtype=np.float64)
        mask1 = Cc > Cb
        denom1 = 255.0 - Cb
        valid_mask1 = mask1 & (denom1 > 0)
        Ac[valid_mask1] = np.ceil(255.0 * (Cc[valid_mask1] - Cb) / denom1)
        mask2 = Cc < Cb
        valid_mask2 = mask2 & (Cb > 0)
        Ac[valid_mask2] = np.ceil(255.0 * (Cb - Cc[valid_mask2]) / Cb)
        return Ac
    Ac_r = get_min_alpha(Rc, Rb)
    Ac_g = get_min_alpha(Gc, Gb)
    Ac_b = get_min_alpha(Bc, Bb)
    Ac_final = np.maximum.reduce([Ac_r, Ac_g, Ac_b])
    def get_new_fg_color(Cc, Cb, Ac):
        new_Cf = np.copy(Cc)
        mask = Ac > 0
        numerator = (Cc[mask] * 255.0) - (Cb * (255.0 - Ac[mask]))
        denominator = Ac[mask]
        new_Cf[mask] = numerator / denominator
        return new_Cf
    new_Rf = get_new_fg_color(Rc, Rb, Ac_final)
    new_Gf = get_new_fg_color(Gc, Gb, Ac_final)
    new_Bf = get_new_fg_color(Bc, Bb, Ac_final)
    final_arr = np.stack([
        np.clip(new_Rf, 0, 255), np.clip(new_Gf, 0, 255),
        np.clip(new_Bf, 0, 255), np.clip(Ac_final, 0, 255)
    ], axis=-1)
    return Image.fromarray(final_arr.astype(np.uint8), 'RGBA')


# --- GUI APPLICATION CLASS ---

class SketchApp:
    PREVIEW_MAX_WIDTH = 600
    PREVIEW_MAX_HEIGHT = 500
    CONTROLS_WIDTH = 250
    DEBOUNCE_DELAY = 150

    def __init__(self, root):
        self.root = root
        self.root.title("AnnaRoblox's Bait Maker")
        self.root.geometry(f"{self.CONTROLS_WIDTH + self.PREVIEW_MAX_WIDTH + 40}x{self.PREVIEW_MAX_HEIGHT + 100}")
        self.root.minsize(700, 400)

        self.input_path = ""
        self.original_cv_image = None
        self.processed_sketch_cv = None # This will store the grayscale sketch
        self.preview_photo_image = None
        self.update_job = None

        main_frame = ttk.Frame(root)
        main_frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)

        controls_frame = ttk.Frame(main_frame, width=self.CONTROLS_WIDTH)
        controls_frame.pack(side=tk.LEFT, fill=tk.Y, padx=(0, 10))
        controls_frame.pack_propagate(False)

        preview_frame = ttk.Labelframe(main_frame, text="Preview")
        preview_frame.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        self.select_button = ttk.Button(controls_frame, text="1. Select Image...", command=self.select_file)
        self.select_button.pack(fill=tk.X, pady=(0, 5))
        self.file_label = ttk.Label(controls_frame, text="No file selected", foreground="gray", wraplength=self.CONTROLS_WIDTH-20)
        self.file_label.pack(pady=(0, 10), fill=tk.X)

        params_frame = ttk.Labelframe(controls_frame, text="Parameters", padding="10")
        params_frame.pack(fill=tk.X, pady=5)

        ttk.Label(params_frame, text="Pencil tip size:").grid(row=0, column=0, sticky="w")
        self.tip_size_var = tk.DoubleVar(value=20.0)
        self.tip_size_slider = ttk.Scale(params_frame, from_=1, to=51, orient=tk.HORIZONTAL, variable=self.tip_size_var, command=self.schedule_update)
        self.tip_size_slider.grid(row=0, column=1, sticky="we")
        self.tip_size_label = ttk.Label(params_frame, text="20.00")
        self.tip_size_label.grid(row=0, column=2, padx=(5,0))

        ttk.Label(params_frame, text="Range:").grid(row=1, column=0, sticky="w")
        self.range_var = tk.DoubleVar(value=-1.5)
        self.range_slider = ttk.Scale(params_frame, from_=-5.0, to=5.0, orient=tk.HORIZONTAL, variable=self.range_var, command=self.schedule_update)
        self.range_slider.grid(row=1, column=1, sticky="we")
        self.range_label = ttk.Label(params_frame, text="-1.50")
        self.range_label.grid(row=1, column=2, padx=(5,0))
        params_frame.columnconfigure(1, weight=1)

        save_frame = ttk.Labelframe(controls_frame, text="2. Download Bait", padding="10")
        save_frame.pack(fill=tk.X, pady=(20, 10))

        self.save_white_button = ttk.Button(save_frame, text="Visible on White", command=lambda: self.save_sketches('white'))
        self.save_white_button.pack(fill=tk.X, pady=2)
        
        self.save_black_button = ttk.Button(save_frame, text="Visible on Black", command=lambda: self.save_sketches('black'))
        self.save_black_button.pack(fill=tk.X, pady=2)

        self.save_both_button = ttk.Button(save_frame, text="Save Both", command=lambda: self.save_sketches('both'), style='Accent.TButton')
        self.save_both_button.pack(fill=tk.X, pady=(5, 2), ipady=4)

        style = ttk.Style()
        style.configure('Accent.TButton', font=('Helvetica', 10, 'bold'))

        self.preview_label = ttk.Label(preview_frame, text="\n\nSelect an image to see a preview.", compound='center', style='Preview.TLabel')
        self.preview_label.pack(fill=tk.BOTH, expand=True)
        style.configure('Preview.TLabel', foreground='gray', font=('Helvetica', 12))

        self.status_var = tk.StringVar(value="Ready. Please select an image.")
        self.status_bar = ttk.Label(root, textvariable=self.status_var, relief=tk.SUNKEN, anchor="w", padding=5)
        self.status_bar.pack(side=tk.BOTTOM, fill=tk.X)
    
    def select_file(self):
        path = filedialog.askopenfilename(
            title="Select an image file",
            filetypes=[("Image Files", "*.png *.jpg *.jpeg *.bmp *.webp"), ("All files", "*.*")]
        )
        if path:
            self.input_path = path
            self.original_cv_image = cv2.imread(self.input_path)

            if self.original_cv_image is None:
                messagebox.showerror("Error", "Could not read the image file.")
                self.input_path = ""
                return

            self.file_label.config(text=os.path.basename(path), foreground="black")
            self.status_var.set(f"Loaded: {os.path.basename(path)}")
            self.update_preview()

    def schedule_update(self, event=None):
        self.tip_size_label.config(text=f"{self.tip_size_var.get():.2f}")
        self.range_label.config(text=f"{self.range_var.get():.2f}")
        if self.update_job:
            self.root.after_cancel(self.update_job)
        self.update_job = self.root.after(self.DEBOUNCE_DELAY, self.update_preview)

    def update_preview(self):
        if self.original_cv_image is None: return

        self.status_var.set("Processing preview...")
        self.root.update_idletasks()

        tip_size = self.tip_size_var.get()
        range_param = self.range_var.get()

        sketch, message = create_pencil_sketch_from_image(self.original_cv_image, tip_size, range_param)
        
        if sketch is None:
            self.status_var.set(f"Error: {message}")
            return
        
        self.processed_sketch_cv = sketch

        pil_image = Image.fromarray(self.processed_sketch_cv)
        pil_image.thumbnail((self.PREVIEW_MAX_WIDTH, self.PREVIEW_MAX_HEIGHT), Image.Resampling.LANCZOS)
        self.preview_photo_image = ImageTk.PhotoImage(pil_image)
        self.preview_label.config(image=self.preview_photo_image, text="")
        self.status_var.set("Ready.")

    # --- CORRECTED: This function now creates the correct base image for each mode ---
    def save_sketches(self, mode):
        """Saves sketch(es) as transparent PNGs using the color clearer method."""
        if self.processed_sketch_cv is None or not self.input_path:
            messagebox.showwarning("Not Ready", "Please select an image and generate a preview first.")
            return

        output_folder = filedialog.askdirectory(title="Select a Folder to Save Baits")
        if not output_folder:
            self.status_var.set("Save cancelled.")
            return

        base_name = os.path.splitext(os.path.basename(self.input_path))[0]
        sketch_gray = self.processed_sketch_cv
        saved_files = []

        try:
            # The alpha channel is the inverse of the sketch's brightness.
            # This is the same for both black and white baits.
            alpha_channel = 255 - sketch_gray

            # --- Process and save the "visible on white" version ---
            if mode in ['white', 'both']:
                # For a white background, we need a BLACK sketch.
                # Create an RGBA image with black sketch lines and the calculated alpha.
                rgb_black = np.zeros((sketch_gray.shape[0], sketch_gray.shape[1], 3), dtype=np.uint8)
                rgba_sketch_arr = np.dstack((rgb_black, alpha_channel))
                base_sketch_pil = Image.fromarray(rgba_sketch_arr, 'RGBA')

                # Apply the clearer for a white background
                final_image = apply_color_clearer(base_sketch_pil, target_color=[255, 255, 255])
                
                output_filename = f"{base_name}_bait_white.png"
                output_path = os.path.join(output_folder, output_filename)
                final_image.save(output_path, "PNG")
                saved_files.append(output_filename)

            # --- Process and save the "visible on black" version ---
            if mode in ['black', 'both']:
                # For a black background, we need a WHITE sketch.
                # Create an RGBA image with white sketch lines and the calculated alpha.
                rgb_white = np.full((sketch_gray.shape[0], sketch_gray.shape[1], 3), 255, dtype=np.uint8)
                rgba_sketch_arr = np.dstack((rgb_white, alpha_channel))
                base_sketch_pil = Image.fromarray(rgba_sketch_arr, 'RGBA')
                
                # Apply the clearer for a black background
                final_image = apply_color_clearer(base_sketch_pil, target_color=[0, 0, 0])
                
                output_filename = f"{base_name}_bait_black.png"
                output_path = os.path.join(output_folder, output_filename)
                final_image.save(output_path, "PNG")
                saved_files.append(output_filename)

            messagebox.showinfo("Success!", f"Successfully saved to:\n{output_folder}")
            self.status_var.set(f"Saved: {', '.join(saved_files)}")

        except Exception as e:
            import traceback
            traceback.print_exc()
            messagebox.showerror("Save Error", f"Could not save the file(s).\nReason: {e}")
            self.status_var.set("Error during save operation.")


if __name__ == "__main__":
    root = tk.Tk()
    app = SketchApp(root)
    root.mainloop()