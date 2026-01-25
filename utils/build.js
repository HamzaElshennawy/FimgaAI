const esbuild = require("esbuild");
const path = require("path");

esbuild
    .build({
        entryPoints: ["src/code.ts"],
        outfile: "dist/code.js",
        bundle: true,
        target: "es6",
        platform: "browser",
        alias: {
            "@google/genai": path.resolve(
                __dirname,
                "../node_modules/@google/genai/dist/web/index.mjs",
            ),
        },
    })
    .then(() => {
        console.log("Build succeeded");
    })
    .catch(() => {
        console.error("Build failed");
        process.exit(1);
    });
