// Runs this code if the plugin is run in Figma
figma.showUI(__html__, { themeColors: true, width: 500, height: 600 });

const serializeNode = (node: SceneNode): any => {
    const data: any = {
        id: node.id,
        name: node.name,
        type: node.type,
        x: Math.round(node.x),
        y: Math.round(node.y),
        width: Math.round(node.width),
        height: Math.round(node.height),
    };

    if (node.type === "TEXT") {
        data.text = (node as TextNode).characters;
        data.fontSize = (node as TextNode).fontSize;
    }

    if ("fills" in node && (node.fills as ReadonlyArray<Paint>).length > 0) {
        const fill = (node.fills as ReadonlyArray<Paint>)[0];
        if (fill.type === "SOLID") {
            data.color = {
                r: Math.round(fill.color.r * 255),
                g: Math.round(fill.color.g * 255),
                b: Math.round(fill.color.b * 255),
            };
        }
    }

    if ("children" in node) {
        data.children = (node as FrameNode).children.map((child) =>
            serializeNode(child),
        );
    }
    return data;
};

figma.ui.onmessage = async (msg) => {
    if (msg.type === "check-api-key") {
        const key = await figma.clientStorage.getAsync("gemini_api_key");
        figma.ui.postMessage({ type: "api-key", key });
    } else if (msg.type === "save-api-key") {
        await figma.clientStorage.setAsync("gemini_api_key", msg.key);
    } else if (msg.type === "get-selection-context") {
        const selection = figma.currentPage.selection;
        if (selection.length === 0) {
            figma.ui.postMessage({
                type: "selection-context",
                error: "No selection",
            });
        } else {
            const node = selection[0];
            try {
                // Get Tree
                const tree = serializeNode(node);
                // Get Image
                const bytes = await node.exportAsync({
                    format: "PNG",
                    constraint: { type: "SCALE", value: 1 },
                });

                figma.ui.postMessage({
                    type: "selection-context",
                    tree: tree,
                    imageBytes: bytes,
                });
                figma.notify("Selection context captured.");
            } catch (err: any) {
                figma.notify("Error capturing context: " + err.message);
            }
        }
    } else if (msg.type === "draw-design") {
        try {
            const designData = msg.designData;

            if (designData.layers && Array.isArray(designData.layers)) {
                let parentFrame: FrameNode;

                // Check for override
                if (msg.replaceContext && msg.contextId) {
                    const existingNode = figma.getNodeById(
                        msg.contextId,
                    ) as FrameNode;
                    if (existingNode && existingNode.type === "FRAME") {
                        parentFrame = existingNode;
                        // Clear existing children
                        parentFrame.children.forEach((child) => child.remove());
                        figma.notify("Updating existing frame...");
                    } else {
                        // Fallback if node not found
                        parentFrame = figma.createFrame();
                        parentFrame.name = "Gemini Generation";
                        parentFrame.x = figma.viewport.center.x;
                        parentFrame.y = figma.viewport.center.y;
                        figma.currentPage.appendChild(parentFrame);
                    }
                } else {
                    // Create new
                    parentFrame = figma.createFrame();
                    parentFrame.name = "Gemini Generation";
                    parentFrame.x = figma.viewport.center.x;
                    parentFrame.y = figma.viewport.center.y;
                    figma.currentPage.appendChild(parentFrame);
                }

                // Ensure size is correct (default or based on generation)
                // We typically get width/height from generation, if not we default.
                // Assuming the first layer or overall bounds implies size, but for now fixed to mobile or keeping existing size if override.
                if (!msg.replaceContext) {
                    parentFrame.resize(375, 812);
                }

                const createSolidPaint = (color: any): SolidPaint => {
                    return {
                        type: "SOLID",
                        color: {
                            r: color.r,
                            g: color.g,
                            b: color.b,
                        },
                        opacity:
                            color.a !== undefined
                                ? color.a
                                : color.opacity !== undefined
                                  ? color.opacity
                                  : 1,
                    };
                };

                const createLayer = async (
                    layer: any,
                    parent: BaseNode & ChildrenMixin,
                ) => {
                    let node: SceneNode | null = null;

                    if (layer.type === "FRAME") {
                        const frame = figma.createFrame();
                        frame.resize(layer.width || 100, layer.height || 100);
                        frame.x = layer.x || 0;
                        frame.y = layer.y || 0;

                        // Fills (Solid or Gradient)
                        if (layer.fills) {
                            frame.fills = layer.fills;
                        } else if (layer.color) {
                            frame.fills = [createSolidPaint(layer.color)];
                        } else {
                            frame.fills = []; // Transparent if no color
                        }

                        // Auto Layout
                        if (layer.layoutMode) {
                            frame.layoutMode = layer.layoutMode; // "HORIZONTAL" | "VERTICAL"
                            frame.primaryAxisAlignItems =
                                layer.primaryAxisAlignItems || "MIN";
                            frame.counterAxisAlignItems =
                                layer.counterAxisAlignItems || "MIN";
                            frame.itemSpacing = layer.itemSpacing || 0;
                            frame.paddingTop =
                                layer.paddingTop || layer.padding || 0;
                            frame.paddingBottom =
                                layer.paddingBottom || layer.padding || 0;
                            frame.paddingLeft =
                                layer.paddingLeft || layer.padding || 0;
                            frame.paddingRight =
                                layer.paddingRight || layer.padding || 0;

                            if (
                                layer.primaryAxisSizingMode === "FIXED" ||
                                layer.primaryAxisSizingMode === "AUTO"
                            ) {
                                frame.primaryAxisSizingMode =
                                    layer.primaryAxisSizingMode;
                            }
                            if (
                                layer.counterAxisSizingMode === "FIXED" ||
                                layer.counterAxisSizingMode === "AUTO"
                            ) {
                                frame.counterAxisSizingMode =
                                    layer.counterAxisSizingMode;
                            }
                        }

                        node = frame;
                    } else if (
                        layer.type === "RECTANGLE" ||
                        layer.type === "IMAGE"
                    ) {
                        const rect = figma.createRectangle();
                        rect.resize(layer.width || 100, layer.height || 100);
                        rect.x = layer.x || 0;
                        rect.y = layer.y || 0;
                        if (layer.type === "IMAGE") {
                            // Placeholder for image
                            rect.fills = [
                                {
                                    type: "SOLID",
                                    color: { r: 0.85, g: 0.85, b: 0.85 },
                                },
                            ];
                            const label = figma.createText();
                            await figma.loadFontAsync({
                                family: "Inter",
                                style: "Regular",
                            });
                            label.characters = "IMAGE";
                            label.fontSize = 10;
                            label.x = (layer.x || 0) + 5;
                            label.y = (layer.y || 0) + 5;
                            parent.appendChild(label);
                        } else {
                            if (layer.fills) rect.fills = layer.fills;
                            else
                                rect.fills = [
                                    createSolidPaint(
                                        layer.color || {
                                            r: 0.5,
                                            g: 0.5,
                                            b: 0.5,
                                        },
                                    ),
                                ];
                        }
                        node = rect;
                    } else if (layer.type === "ELLIPSE") {
                        const ellipse = figma.createEllipse();
                        ellipse.resize(layer.width || 100, layer.height || 100);
                        ellipse.x = layer.x || 0;
                        ellipse.y = layer.y || 0;
                        if (layer.fills) ellipse.fills = layer.fills;
                        else
                            ellipse.fills = [
                                createSolidPaint(
                                    layer.color || { r: 0.5, g: 0.5, b: 0.5 },
                                ),
                            ];
                        node = ellipse;
                    } else if (layer.type === "LINE") {
                        const line = figma.createLine();
                        line.resize(layer.width || 100, 0);
                        line.x = layer.x || 0;
                        line.y = layer.y || 0;
                        if (layer.color) {
                            line.strokes = [createSolidPaint(layer.color)];
                            line.strokeWeight = layer.strokeWeight || 1;
                        }
                        node = line;
                    } else if (layer.type === "STAR") {
                        const star = figma.createStar();
                        star.resize(layer.width || 100, layer.height || 100);
                        star.x = layer.x || 0;
                        star.y = layer.y || 0;
                        star.fills = [
                            createSolidPaint(
                                layer.color || { r: 1, g: 0.8, b: 0 },
                            ),
                        ];
                        node = star;
                    } else if (layer.type === "POLYGON") {
                        const poly = figma.createPolygon();
                        poly.resize(layer.width || 100, layer.height || 100);
                        poly.x = layer.x || 0;
                        poly.y = layer.y || 0;
                        poly.fills = [
                            createSolidPaint(
                                layer.color || { r: 0.5, g: 0.5, b: 0.5 },
                            ),
                        ];
                        node = poly;
                    } else if (layer.type === "TEXT") {
                        const style =
                            layer.fontWeight === "Bold"
                                ? "Bold"
                                : layer.fontWeight === "Medium"
                                  ? "Medium"
                                  : "Regular";
                        const fontName = { family: "Inter", style: style };

                        // Load the target font
                        await figma.loadFontAsync(fontName).catch(() => {
                            // Fallback if target fails
                            console.warn(
                                `Failed to load ${style}, falling back to Regular`,
                            );
                            return figma.loadFontAsync({
                                family: "Inter",
                                style: "Regular",
                            });
                        });

                        const text = figma.createText();

                        // IMPORTANT: Set fontName BEFORE setting characters if it's not the default
                        // But we must assume 'Inter Regular' might be the default and we didn't load it if we loaded Bold.
                        // However, setting fontName only requires the target font to be loaded.
                        text.fontName = fontName;

                        text.x = layer.x || 0;
                        text.y = layer.y || 0;
                        text.characters = layer.text || "Text";
                        text.fontSize = layer.fontSize || 14;
                        if (layer.color) {
                            text.fills = [createSolidPaint(layer.color)];
                        }
                        if (layer.textAlignHorizontal)
                            text.textAlignHorizontal =
                                layer.textAlignHorizontal;
                        if (layer.textAlignVertical)
                            text.textAlignVertical = layer.textAlignVertical;
                        if (layer.width) text.resize(layer.width, text.height);
                        if (layer.autoGrow)
                            text.textAutoResize = "WIDTH_AND_HEIGHT";

                        node = text;
                    }

                    if (node) {
                        node.name = layer.name || layer.type;

                        // Common Styling properties
                        if (layer.layoutAlign && "layoutAlign" in node) {
                            // Figma only supports "STRETCH" (Fill container) or "INHERIT" (Fixed) for layoutAlign.
                            // MIN, CENTER, MAX are deprecated/invalid. Alignment is correctly handled by parent's alignItems.
                            if (layer.layoutAlign === "STRETCH") {
                                (node as any).layoutAlign = "STRETCH";
                            } else if (layer.layoutAlign === "INHERIT") {
                                (node as any).layoutAlign = "INHERIT";
                            }
                        }
                        if (
                            layer.layoutGrow !== undefined &&
                            "layoutGrow" in node
                        ) {
                            (node as any).layoutGrow = layer.layoutGrow; // 0 or 1
                        }
                        if ("cornerRadius" in node && layer.cornerRadius) {
                            (node as any).cornerRadius = layer.cornerRadius;
                        }
                        if ("strokes" in node && layer.strokeColor) {
                            (node as any).strokes = [
                                createSolidPaint(layer.strokeColor),
                            ];
                            (node as any).strokeWeight =
                                layer.strokeWeight || 1;
                        }
                        if ("opacity" in node && layer.opacity !== undefined) {
                            (node as any).opacity = layer.opacity;
                        }
                        if ("effects" in node && layer.shadow) {
                            (node as any).effects = [
                                {
                                    type: "DROP_SHADOW",
                                    color: { r: 0, g: 0, b: 0, a: 0.2 },
                                    offset: { x: 0, y: 4 },
                                    radius: 4,
                                    visible: true,
                                    blendMode: "NORMAL",
                                },
                            ];
                        }

                        parent.appendChild(node);

                        // Recursion for children (Frames)
                        const children = layer.children || layer.layers;
                        if (children && layer.type === "FRAME") {
                            for (const child of children) {
                                // Adjust child coordinates to be relative to parent frame if needed
                                // But prompt usually gives absolute or relative.
                                // Helper: If prompt gives absolute coordinates, we might need to adjust.
                                // But let's assume prompt gives coordinates relative to parent if it's nested structure.
                                // OR, simpler: Instruct prompt to use relative coordinates.
                                await createLayer(child, node as FrameNode);
                            }
                        }
                    }
                };

                for (const layer of designData.layers) {
                    await createLayer(layer, parentFrame);
                }

                figma.currentPage.selection = [parentFrame];
                figma.viewport.scrollAndZoomIntoView([parentFrame]);
                figma.notify("Design generated and drawn!");
                figma.ui.postMessage({ type: "design-drawn" });
            } else {
                figma.notify("Failed to parse design data.");
            }
        } catch (error: any) {
            console.error("Drawing Error:", error);
            figma.notify("Error drawing design: " + error.message);
        }
    } else if (msg.type === "cancel") {
        figma.closePlugin();
    }
};
