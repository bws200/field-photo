# Field Stamp

Field Stamp is a small, installable web app for Android. It uses the camera or a photo you choose, adds a date/time and description on the first stamp line, and adds optional free text on the second. Camera photos use the time the shutter is pressed. Chosen JPEG and PNG photos use their embedded EXIF capture time when available; otherwise, the app uses the file's modified time and tells you. The exported PNG filename uses the timestamp and first-line description in snake_case; the second line is never included.

Photos are processed in the browser and are not uploaded.

## Deploy with GitHub Pages

1. Create a GitHub repository and push this project to its `main` branch.
2. In the repository, open **Settings → Pages** and set the build and deployment source to **GitHub Actions**.
3. The included workflow publishes the app automatically when changes are pushed to `main`. You can also run it from **Actions → Deploy to GitHub Pages → Run workflow**.
4. Once deployment completes, open the Pages URL shown in the workflow in Chrome on Android and allow camera access.
5. In Chrome's menu, choose **Install app** or **Add to Home screen**.

The app is static and requires no build command. The workflow copies only the app files into the Pages artifact, and its relative asset paths work for both project and user sites. Camera access requires HTTPS (GitHub Pages provides it) or localhost. The app shell is cached for offline use after its first visit; camera permissions and saving still depend on Android and the browser.

The footer shows the short commit ID of the deployed build, which you can use to identify the version installed on your phone. A locally served copy shows `dev`.
