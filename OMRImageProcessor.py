import cv2
import numpy as np
import google.generativeai as genai
import os
from PIL import Image

class OMRImageProcessor:
    """
    Pemproses imej OMR khusus untuk:
    1. Pembetulan perspektif
    2. Pengambangan suai Gaussian
    3. Semakan AI (Gemini)
    """

    def __init__(self):
        # Konfigurasi API Key untuk Gemini
        api_key = os.environ.get("GEMINI_API_KEY")
        if api_key:
            genai.configure(api_key=api_key)
            self.model = genai.GenerativeModel('gemini-2.5-flash')
        else:
            self.model = None

    def perspective_correction(self, image, corner_points):
        """
        Membetulkan perspektif imej OMR kepada paparan atas bird's-eye view.
        """
        pts = np.array(corner_points, dtype=np.float32)
        top_left, top_right, bottom_right, bottom_left = pts

        width_top = np.sqrt(((top_right[0] - top_left[0]) ** 2) + ((top_right[1] - top_left[1]) ** 2))
        width_bottom = np.sqrt(((bottom_right[0] - bottom_left[0]) ** 2) + ((bottom_right[1] - bottom_left[1]) ** 2))
        new_width = int(max(width_top, width_bottom))

        height_right = np.sqrt(((bottom_right[0] - top_right[0]) ** 2) + ((bottom_right[1] - top_right[1]) ** 2))
        height_left = np.sqrt(((bottom_left[0] - top_left[0]) ** 2) + ((bottom_left[1] - top_left[1]) ** 2))
        new_height = int(max(height_right, height_left))

        dst = np.array([
            [0, 0],
            [new_width - 1, 0],
            [new_width - 1, new_height - 1],
            [0, new_height - 1]
        ], dtype=np.float32)

        matrix = cv2.getPerspectiveTransform(pts, dst)

        warped_image = cv2.warpPerspective(
            image,
            matrix,
            (new_width, new_height),
            flags=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_CONSTANT,
            borderValue=(255, 255, 255)
        )

        return warped_image

    def adaptive_binarization(self, image, block_size=11, C=7):
        """
        Melakukan pengambangan suai Gaussian untuk menonjolkan lorekan pensel / dakwat.
        """
        if len(image.shape) == 3:
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        else:
            gray = image.copy()

        if block_size % 2 == 0:
            block_size += 1
        if block_size <= 1:
            block_size = 3

        gray_blur = cv2.GaussianBlur(gray, (3, 3), 0)

        binary_image = cv2.adaptiveThreshold(
            gray_blur,
            255,
            cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY_INV,
            block_size,
            C
        )

        return binary_image

    def verify_with_ai(self, image, corner_points, skema_jawapan):
        """
        Hanya untuk semakan AI sahaja:
        Memproses imej untuk AI (melalui pembetulan perspektif dan sedikit pra-pemprosesan) 
        dan kemudian menghantarnya ke API Gemini untuk proses pemverifikasi jawapan.
        """
        if not self.model:
            raise Exception("Sila tetapkan pembolehubah persekitaran GEMINI_API_KEY terlebih dahulu.")

        # 1. Betulkan perspektif
        corrected_image = self.perspective_correction(image, corner_points)
        
        # Simpan imej sementara untuk dihantar ke Gemini
        temp_filename = "temp_omr_for_ai.jpg"
        cv2.imwrite(temp_filename, corrected_image)
        
        # 2. Hantar kepada Gemini
        try:
            img = Image.open(temp_filename)
            prompt = f"Anda adalah sistem semakan OMR. Sila semak imej OMR yang telah dibetulkan perspektif ini dengan skema jawapan berikut: {skema_jawapan}. Sila berikan jawapan dalam format JSON."
            
            response = self.model.generate_content([prompt, img])
            return response.text
        finally:
            if os.path.exists(temp_filename):
                os.remove(temp_filename)


# Contoh penggunaan
if __name__ == "__main__":
    image = cv2.imread("omr_sample.jpg")

    if image is None:
        print("Imej tidak dijumpai. Menghentikan skrip...")
    else:
        corner_points = [
            [120, 80],     # kiri atas
            [850, 100],    # kanan atas
            [900, 1200],   # kanan bawah
            [90, 1180]     # kiri bawah
        ]

        processor = OMRImageProcessor()

        # Semakan AI Sahaja
        print("Memulakan semakan AI...")
        skema = "1=A, 2=B, 3=C, 4=D"
        hasil_ai = processor.verify_with_ai(image, corner_points, skema)
        print("Hasil Semakan AI:", hasil_ai)
