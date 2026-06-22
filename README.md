<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/3781e351-4fa5-4b7c-8372-49d0f99cf716

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set `GEMINI_API_KEY` in `.env` to your Gemini API key. For rotation/failover, use `GEMINI_API_KEYS=key_1,key_2,key_3`.
3. Run the app:
   `npm run dev`
