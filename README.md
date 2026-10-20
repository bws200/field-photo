# Field Stamp

Field Stamp is a small, installable web app for Android. It uses the camera or a photo you choose, adds a date/time and description on the first stamp line, and adds optional free text on the second. Camera photos use the time the shutter is pressed. Chosen JPEG and PNG photos use their embedded EXIF capture time when available; otherwise, the app uses the file's modified time and tells you. The exported PNG filename uses the timestamp and first-line description in snake_case; the second line is never included.

Photos are processed in the browser and are not uploaded.

## Deploy to Netlify

1. Put these files in a Git repository and import it in Netlify, or drag the project folder into Netlify Drop.
2. Leave the build command blank. The publish directory is `.`.
3. Open the deployed HTTPS URL in Chrome on Android and allow camera access.
4. In Chrome's menu, choose **Install app** or **Add to Home screen**.

Camera access requires HTTPS (Netlify provides it) or localhost. The app shell is cached for offline use after its first visit; camera permissions and saving still depend on Android and the browser.
