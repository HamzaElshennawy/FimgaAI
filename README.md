# FimgaAI - Gemini-Powered Figma Plugin

FimgaAI is a powerful Figma plugin that leverages Google's Gemini API to generate high-fidelity UI designs directly within Figma. It supports advanced Auto Layout, responsive frames, and intelligent styling based on your text prompts.

## Features

- **Text-to-UI Generation**: Describe your interface (e.g., "A modern login screen with a blue button"), and FimgaAI builds it.
- **Contextual Redesign**: Select an existing frame or element, and ask the AI to modify or redesign it.
- **Advanced Auto Layout**: Automatically handles:
    - "Hug Contents" vs "Fill Container" sizing.
    - Proper alignment (Center, Space Between, etc.).
    - Nested frames for robust layouts.
- **Image Support**: Can incorporate image placeholders and detect context from selected images.
- **Theme Awareness**: Generates styles including corner radius, shadows, and strokes.

## Installation

1.  **Clone the repository**:

    ```bash
    git clone <repository-url>
    cd FimgaAI
    ```

2.  **Install dependencies**:

    ```bash
    npm install
    ```

3.  **Build the plugin**:
    ```bash
    npm run build
    ```
    This generates the `dist/code.js` bundle.

## How to Run in Figma

1.  Open **Figma Desktop App**.
2.  Go to **Menu > Plugins > Development > Import plugin from manifest...**.
3.  Select the `manifest.json` file in this project's root directory.
4.  The plugin "Gemini AI Design" will appear in your plugins list.

## Usage

1.  Run the plugin.
2.  **Settings**: Enter your Google Gemini API Key in the Settings tab.
3.  **Generate**:
    - Type a prompt (e.g., "A music player card with album art and controls").
    - Click **Generate**.
4.  **Edit**: Select an element on the canvas to provide context, then type a refinement prompt (e.g., "Make the button red").

## Development

- **Watch mode**:
    ```bash
    npm run watch
    ```
    This will automatically rebuild the plugin when you modify `src/code.ts`.

## Tech Stack

- **Frontend**: HTML/CSS/JS (`src/ui.html`)
- **Backend**: TypeScript (`src/code.ts`)
- **Bundler**: esbuild
- **AI**: Google GenAI SDK (Gemini 2.0 Flash)

## License

MIT
