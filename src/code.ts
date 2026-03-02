// Runs this code if the plugin is run in Figma
figma.showUI(__html__, { themeColors: true, width: 600, height: 1200 });

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

const getProjectSettingsStorageKey = () =>
    `project_settings_${figma.fileKey || figma.root.id}`;

const toNum = (v: unknown, fallback = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
};

const normalizeRgb = (color: any) => {
    if (!color) return null;
    const normalize = (c: unknown) => {
        const n = toNum(c, 0);
        return n > 1 ? Math.max(0, Math.min(1, n / 255)) : Math.max(0, Math.min(1, n));
    };
    return { r: normalize(color.r), g: normalize(color.g), b: normalize(color.b) };
};

const luminance = (c: { r: number; g: number; b: number }) => {
    const channel = (v: number) =>
        v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    const r = channel(c.r);
    const g = channel(c.g);
    const b = channel(c.b);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrastRatio = (
    fg: { r: number; g: number; b: number },
    bg: { r: number; g: number; b: number },
) => {
    const l1 = luminance(fg);
    const l2 = luminance(bg);
    const max = Math.max(l1, l2);
    const min = Math.min(l1, l2);
    return (max + 0.05) / (min + 0.05);
};

const analyzeLayoutQA = (designData: any): string[] => {
    const findings: string[] = [];

    const inspectSiblings = (layers: any[], path: string, parentColor: any) => {
        for (let i = 0; i < layers.length; i += 1) {
            for (let j = i + 1; j < layers.length; j += 1) {
                const a = layers[i];
                const b = layers[j];
                const ax = toNum(a?.x);
                const ay = toNum(a?.y);
                const aw = Math.max(0, toNum(a?.width));
                const ah = Math.max(0, toNum(a?.height));
                const bx = toNum(b?.x);
                const by = toNum(b?.y);
                const bw = Math.max(0, toNum(b?.width));
                const bh = Math.max(0, toNum(b?.height));
                if (aw === 0 || ah === 0 || bw === 0 || bh === 0) continue;
                const overlapX = Math.min(ax + aw, bx + bw) - Math.max(ax, bx);
                const overlapY = Math.min(ay + ah, by + bh) - Math.max(ay, by);
                if (overlapX > 0 && overlapY > 0) {
                    findings.push(
                        `Potential overlap in ${path}: "${a?.name || a?.type}" with "${b?.name || b?.type}".`,
                    );
                }
                if (findings.length >= 8) return;
            }
        }

        for (const layer of layers) {
            const name = String(layer?.name || "").toLowerCase();
            const type = String(layer?.type || "").toUpperCase();
            const width = Math.max(0, toNum(layer?.width));
            const height = Math.max(0, toNum(layer?.height));
            const layerPath = `${path}/${layer?.name || layer?.type || "Layer"}`;
            const currentBg = normalizeRgb(layer?.color) || parentColor;

            if (
                /(button|cta|toggle|tab|chip)/i.test(name) &&
                (width < 44 || height < 44)
            ) {
                findings.push(
                    `Small tap target in ${layerPath}: ${Math.round(width)}x${Math.round(height)}.`,
                );
            }

            if (type === "TEXT") {
                const fg = normalizeRgb(layer?.color);
                const bg = currentBg || { r: 1, g: 1, b: 1 };
                if (fg) {
                    const ratio = contrastRatio(fg, bg);
                    if (ratio < 4.5) {
                        findings.push(
                            `Low text contrast in ${layerPath} (ratio ${ratio.toFixed(2)}).`,
                        );
                    }
                }
            }

            const children = Array.isArray(layer?.children)
                ? layer.children
                : Array.isArray(layer?.layers)
                  ? layer.layers
                  : null;
            if (children?.length) {
                inspectSiblings(children, layerPath, currentBg || parentColor);
            }
            if (findings.length >= 8) return;
        }
    };

    if (Array.isArray(designData?.layers) && designData.layers.length) {
        inspectSiblings(designData.layers, "Root", { r: 1, g: 1, b: 1 });
    }
    return findings.slice(0, 8);
};

const hexToPaint = (hex: string): Paint | null => {
    const value = String(hex || "").trim().replace("#", "");
    if (!/^[0-9A-Fa-f]{6}$/.test(value)) return null;
    const r = parseInt(value.slice(0, 2), 16) / 255;
    const g = parseInt(value.slice(2, 4), 16) / 255;
    const b = parseInt(value.slice(4, 6), 16) / 255;
    return { type: "SOLID", color: { r, g, b } };
};

const ensurePaintStyle = async (name: string, hex?: string | null) => {
    if (!hex) return;
    const paint = hexToPaint(hex);
    if (!paint) return;
    const existing = figma.getLocalPaintStyles().find((s) => s.name === name);
    if (existing) {
        existing.paints = [paint];
        return;
    }
    const style = figma.createPaintStyle();
    style.name = name;
    style.paints = [paint];
};

const applyDesignSystemMode = async (appColor?: any) => {
    if (!appColor) return;
    await ensurePaintStyle("AI/Primary", appColor.primary);
    await ensurePaintStyle("AI/Background", appColor.background);
    await ensurePaintStyle("AI/Surface", appColor.surface);
    await ensurePaintStyle("AI/Text", appColor.text);
};

const nearestStyleIdForPaint = (
    rgb: RGB,
    styleEntries: Array<{ id: string; rgb: RGB }>,
) => {
    if (!styleEntries.length) return "";
    let best = styleEntries[0];
    let bestDist = Number.POSITIVE_INFINITY;
    for (const entry of styleEntries) {
        const dr = rgb.r - entry.rgb.r;
        const dg = rgb.g - entry.rgb.g;
        const db = rgb.b - entry.rgb.b;
        const d = dr * dr + dg * dg + db * db;
        if (d < bestDist) {
            best = entry;
            bestDist = d;
        }
    }
    return best.id;
};

const applyStyleTokensToNodes = (root: FrameNode) => {
    const styles = figma
        .getLocalPaintStyles()
        .filter((s) => /^AI\//.test(s.name))
        .map((s) => {
            const paint = s.paints[0] as SolidPaint;
            return { id: s.id, rgb: paint?.color };
        })
        .filter((s) => s.rgb) as Array<{ id: string; rgb: RGB }>;
    if (!styles.length) return;

    const nodes = [root, ...(root.findAll() as SceneNode[])];
    for (const node of nodes) {
        if ("fills" in node && Array.isArray(node.fills) && node.fills.length > 0) {
            const fill = node.fills[0] as Paint;
            if (fill?.type === "SOLID") {
                const styleId = nearestStyleIdForPaint(fill.color, styles);
                if ("fillStyleId" in node && styleId) {
                    try {
                        (node as any).fillStyleId = styleId;
                    } catch {
                        // ignore unsupported style assignment
                    }
                }
            }
        }
    }
};

const inferVariantValue = (name: string, node: FrameNode): string => {
    const n = (name || "").toLowerCase();
    if (/(primary|main|filled)/.test(n)) return "Primary";
    if (/(secondary|ghost|outline)/.test(n)) return "Secondary";
    if (/(danger|destructive|error)/.test(n)) return "Danger";
    if ("fills" in node && Array.isArray(node.fills) && node.fills.length > 0) {
        const fill = node.fills[0] as Paint;
        if (fill.type === "SOLID") {
            const l = fill.color.r * 0.2126 + fill.color.g * 0.7152 + fill.color.b * 0.0722;
            return l < 0.5 ? "Primary" : "Secondary";
        }
    }
    return "Default";
};

const inferComponentGroup = (name: string): string | null => {
    const n = (name || "").toLowerCase();
    if (/(button|btn|cta)/.test(n)) return "Button";
    if (/(card|tile)/.test(n)) return "Card";
    if (/(input|field|textbox|search)/.test(n)) return "Input";
    if (/(nav|tab|menu)/.test(n)) return "Navigation";
    return null;
};

const buildReusableComponents = (root: FrameNode) => {
    const candidates = root.findAll(
        (n) => n.id !== root.id && n.type === "FRAME",
    ) as FrameNode[];

    const byGroup = new Map<string, ComponentNode[]>();
    for (const node of candidates.slice(0, 30)) {
        const group = inferComponentGroup(node.name || "");
        if (!group) continue;
        try {
            const variant = inferVariantValue(node.name || "", node);
            const comp = figma.createComponentFromNode(node);
            comp.name = `${group}/${variant}`;
            const list = byGroup.get(group) || [];
            list.push(comp);
            byGroup.set(group, list);
        } catch {
            // skip invalid component conversions
        }
    }

    for (const [group, comps] of byGroup.entries()) {
        if (!comps.length) continue;
        if (comps.length === 1) {
            comps[0].name = `${group}/Default`;
            continue;
        }
        try {
            const set = figma.combineAsVariants(comps, figma.currentPage);
            set.name = `${group}`;
            set.variantGroupProperties = {
                Type: {
                    values: comps.map((c) => c.name.split("/")[1] || "Default"),
                },
            } as any;
        } catch {
            // if combine fails, keep individual components
        }
    }
};

const applyResponsivePass = (root: FrameNode, screenLayout: "mobile" | "desktop") => {
    const nodes = root.findAll() as SceneNode[];
    for (const node of nodes) {
        if (!("constraints" in node)) continue;
        try {
            const width = "width" in node ? Number((node as any).width) : 0;
            const x = "x" in node ? Number((node as any).x) : 0;
            const rightGap = root.width - (x + width);
            if (screenLayout === "desktop") {
                if (width > root.width * 0.55 || (x < 24 && rightGap < 24)) {
                    (node as any).constraints = {
                        horizontal: "STRETCH",
                        vertical: "MIN",
                    };
                } else {
                    (node as any).constraints = {
                        horizontal: "MIN",
                        vertical: "MIN",
                    };
                }
            } else {
                (node as any).constraints = {
                    horizontal: "MIN",
                    vertical: "MIN",
                };
            }
        } catch {
            // ignore unsupported nodes
        }
    }
};

const linkFlowFrames = (frames: FrameNode[]) => {
    if (frames.length < 2) return;
    for (let i = 0; i < frames.length - 1; i += 1) {
        const current = frames[i] as any;
        const next = frames[i + 1];
        try {
            current.reactions = [
                {
                    trigger: { type: "ON_CLICK" },
                    action: {
                        type: "NODE",
                        destinationId: next.id,
                        navigation: "NAVIGATE",
                        transition: {
                            type: "SMART_ANIMATE",
                            easing: { type: "EASE_IN_AND_OUT" },
                            duration: 0.25,
                        },
                        preserveScrollPosition: false,
                    },
                },
            ];
        } catch {
            // keep rendering even if prototype linking fails
        }
    }
};

figma.ui.onmessage = async (msg) => {
    if (msg.type === "check-api-key") {
        const key = await figma.clientStorage.getAsync("gemini_api_key");
        const colorScheme = await figma.clientStorage.getAsync("app_color_scheme");
        const projectSettings = await figma.clientStorage.getAsync(
            getProjectSettingsStorageKey(),
        );
        figma.ui.postMessage({ type: "api-key", key, colorScheme, projectSettings });
    } else if (msg.type === "save-api-key") {
        await figma.clientStorage.setAsync("gemini_api_key", msg.key);
    } else if (msg.type === "save-color-scheme") {
        await figma.clientStorage.setAsync("app_color_scheme", msg.colorScheme);
    } else if (msg.type === "save-project-settings") {
        await figma.clientStorage.setAsync(
            getProjectSettingsStorageKey(),
            msg.settings || {},
        );
    } else if (msg.type === "get-selection-context") {
        const selection = figma.currentPage.selection;
        if (selection.length === 0) {
            figma.ui.postMessage({
                type: "selection-context",
                error: "No selection",
            });
        } else {
            try {
                const trees: any[] = [];
                const imageBytesArray: Uint8Array[] = [];

                for (const node of selection) {
                    const tree = serializeNode(node);
                    trees.push(tree);
                    try {
                        const bytes = await node.exportAsync({
                            format: "PNG",
                            constraint: { type: "SCALE", value: 1 },
                        });
                        imageBytesArray.push(bytes);
                    } catch (e) {
                        // push empty placeholder so indices align
                        imageBytesArray.push(new Uint8Array());
                    }
                }

                figma.ui.postMessage({
                    type: "selection-context",
                    trees: trees,
                    imageBytesArray: imageBytesArray,
                });
                figma.notify("Selection context captured.");
            } catch (err: any) {
                figma.notify("Error capturing context: " + err.message);
            }
        }
    } else if (msg.type === "draw-design") {
        try {
            const designData = msg.designData;
            const screenLayout = msg.screenLayout === "desktop" ? "desktop" : "mobile";
            const defaultFrameSize =
                screenLayout === "desktop"
                    ? { width: 1440, height: 1024, layoutMode: "HORIZONTAL" as const }
                    : { width: 375, height: 812, layoutMode: "VERTICAL" as const };
            const requestedScreenCount = Math.max(
                1,
                Math.min(5, Number(msg.screenCount || 1)),
            );
            const screensFromAI = Array.isArray(designData?.screens)
                ? designData.screens.filter(
                      (s: any) => s && Array.isArray(s.layers) && s.layers.length > 0,
                  )
                : [];
            const normalizedScreens =
                screensFromAI.length > 0
                    ? screensFromAI
                    : [
                          {
                              name:
                                  typeof designData?.designName === "string"
                                      ? designData.designName
                                      : "Screen 1",
                              width: defaultFrameSize.width,
                              height: defaultFrameSize.height,
                              layers: Array.isArray(designData?.layers)
                                  ? designData.layers
                                  : [],
                          },
                      ];
            const rawDesignName =
                typeof designData?.designName === "string"
                    ? designData.designName
                    : typeof designData?.name === "string"
                      ? designData.name
                      : typeof designData?.title === "string"
                        ? designData.title
                        : "";
            const designName =
                rawDesignName.trim().slice(0, 64) || "Gemini Generation";
            const normalizeLayoutGrow = (value: unknown): 0 | 1 => {
                if (value === true || value === "1") return 1;
                const n = Number(value);
                return n >= 1 ? 1 : 0;
            };

            if (
                Array.isArray(normalizedScreens) &&
                normalizedScreens.length > 0 &&
                normalizedScreens.some((s: any) => Array.isArray(s.layers))
            ) {
                const contextIds: string[] | null = msg.contextIds || null;

                // Only fan out to multiple targets when explicitly replacing selected context frames
                if (msg.replaceContext && Array.isArray(contextIds) && contextIds.length > 0) {
                    let offset = 0;
                    const renderedFrames: FrameNode[] = [];
                    for (const ctxId of contextIds) {
                        let parentFrame: FrameNode;
                        if (msg.replaceContext && ctxId) {
                            const existingNode = figma.getNodeById(ctxId) as FrameNode;
                            if (existingNode && existingNode.type === "FRAME") {
                                parentFrame = existingNode;
                                parentFrame.name = designName;
                                parentFrame.children.forEach((child) => child.remove());
                                figma.notify("Updating existing frame...");
                            } else {
                                parentFrame = figma.createFrame();
                                parentFrame.name = designName;
                                parentFrame.x = figma.viewport.center.x + offset;
                                parentFrame.y = figma.viewport.center.y + offset;
                                figma.currentPage.appendChild(parentFrame);
                            }
                        } else {
                            parentFrame = figma.createFrame();
                            parentFrame.name = designName;
                            parentFrame.x = figma.viewport.center.x + offset;
                            parentFrame.y = figma.viewport.center.y + offset;
                            figma.currentPage.appendChild(parentFrame);
                        }

                        // create layers into this parent
                        // Keep generated layers absolute-positioned inside a fixed canvas
                        if (!msg.replaceContext) {
                            parentFrame.layoutMode = "NONE";
                            parentFrame.resize(
                                defaultFrameSize.width,
                                defaultFrameSize.height,
                            );
                        }

                        const createSolidPaint = (color: any): SolidPaint => {
                            return {
                                type: "SOLID",
                                color: {
                                    r: color.r,
                                    g: color.g,
                                    b: color.b,
                                },
                                opacity: color.a !== undefined ? color.a : color.opacity !== undefined ? color.opacity : 1,
                            };
                        };

                        const createLayer = async (layer: any, parent: BaseNode & ChildrenMixin) => {
                            // existing implementation will be copied below by falling through to the normal handler
                        };

                        // We'll reuse existing createLayer implementation by iterating layers below (fall-through)
                        const activeScreen = normalizedScreens[0];
                        for (const layer of activeScreen.layers || []) {
                            // use existing createLayer implementation (duplicate logic below)
                            await (async function createLayerInner(layer: any, parent: BaseNode & ChildrenMixin) {
                                let node: SceneNode | null = null;

                        // Below is the full inner implementation of createLayer used earlier
                                if (layer.type === "FRAME") {
                                    const frame = figma.createFrame();
                                    frame.resize(layer.width || 100, layer.height || 100);
                                    frame.x = layer.x || 0;
                                    frame.y = layer.y || 0;

                                    if (layer.fills) {
                                        frame.fills = layer.fills;
                                    } else if (layer.color) {
                                        frame.fills = [createSolidPaint(layer.color)];
                                    } else {
                                        frame.fills = [];
                                    }

                                    if (layer.layoutMode) {
                                        frame.layoutMode = layer.layoutMode;
                                        const pAlign = layer.primaryAxisAlignItems ? layer.primaryAxisAlignItems.toUpperCase() : "MIN";
                                        if (["MIN","MAX","CENTER","SPACE_BETWEEN"].includes(pAlign)) frame.primaryAxisAlignItems = pAlign as any;
                                        const cAlign = layer.counterAxisAlignItems ? layer.counterAxisAlignItems.toUpperCase() : "MIN";
                                        if (["MIN","MAX","CENTER","BASELINE"].includes(cAlign)) frame.counterAxisAlignItems = cAlign as any;

                                        frame.itemSpacing = layer.itemSpacing || 0;
                                        frame.paddingTop = layer.paddingTop || layer.padding || 0;
                                        frame.paddingBottom = layer.paddingBottom || layer.padding || 0;
                                        frame.paddingLeft = layer.paddingLeft || layer.padding || 0;
                                        frame.paddingRight = layer.paddingRight || layer.padding || 0;

                                        if (layer.primaryAxisSizingMode) {
                                            const pSize = layer.primaryAxisSizingMode.toUpperCase();
                                            if (pSize === "FIXED" || pSize === "AUTO") frame.primaryAxisSizingMode = pSize as any;
                                        }
                                        if (layer.counterAxisSizingMode) {
                                            const cSize = layer.counterAxisSizingMode.toUpperCase();
                                            if (cSize === "FIXED" || cSize === "AUTO") frame.counterAxisSizingMode = cSize as any;
                                        }
                                    }
                                    node = frame;
                                } else if (layer.type === "RECTANGLE" || layer.type === "IMAGE") {
                                    const rect = figma.createRectangle();
                                    rect.resize(layer.width || 100, layer.height || 100);
                                    rect.x = layer.x || 0;
                                    rect.y = layer.y || 0;
                                    if (layer.type === "IMAGE") {
                                        rect.fills = [{ type: "SOLID", color: { r: 0.85, g: 0.85, b: 0.85 } }];
                                        const label = figma.createText();
                                        await figma.loadFontAsync({ family: "Inter", style: "Regular" });
                                        label.characters = "IMAGE";
                                        label.fontSize = 10;
                                        label.x = (layer.x || 0) + 5;
                                        label.y = (layer.y || 0) + 5;
                                        parent.appendChild(label);
                                    } else {
                                        if (layer.fills) rect.fills = layer.fills;
                                        else rect.fills = [createSolidPaint(layer.color || { r: 0.5, g: 0.5, b: 0.5 })];
                                    }
                                    node = rect;
                                } else if (layer.type === "ELLIPSE") {
                                    const ellipse = figma.createEllipse();
                                    ellipse.resize(layer.width || 100, layer.height || 100);
                                    ellipse.x = layer.x || 0;
                                    ellipse.y = layer.y || 0;
                                    if (layer.fills) ellipse.fills = layer.fills;
                                    else ellipse.fills = [createSolidPaint(layer.color || { r: 0.5, g: 0.5, b: 0.5 })];
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
                                    star.fills = [createSolidPaint(layer.color || { r: 1, g: 0.8, b: 0 })];
                                    node = star;
                                } else if (layer.type === "POLYGON") {
                                    const poly = figma.createPolygon();
                                    poly.resize(layer.width || 100, layer.height || 100);
                                    poly.x = layer.x || 0;
                                    poly.y = layer.y || 0;
                                    poly.fills = [createSolidPaint(layer.color || { r: 0.5, g: 0.5, b: 0.5 })];
                                    node = poly;
                                } else if (layer.type === "TEXT") {
                                    const style = layer.fontWeight === "Bold" ? "Bold" : layer.fontWeight === "Medium" ? "Medium" : "Regular";
                                    const fontName = { family: "Inter", style: style };
                                    await figma.loadFontAsync(fontName).catch(() => {
                                        console.warn(`Failed to load ${style}, falling back to Regular`);
                                        return figma.loadFontAsync({ family: "Inter", style: "Regular" });
                                    });
                                    const text = figma.createText();
                                    text.fontName = fontName;
                                    text.x = layer.x || 0;
                                    text.y = layer.y || 0;
                                    text.characters = layer.text || "Text";
                                    text.fontSize = layer.fontSize || 14;
                                    if (layer.color) text.fills = [createSolidPaint(layer.color)];
                                    if (layer.textAlignHorizontal) text.textAlignHorizontal = layer.textAlignHorizontal;
                                    if (layer.textAlignVertical) text.textAlignVertical = layer.textAlignVertical;
                                    if (layer.width) text.resize(layer.width, text.height);
                                    if (layer.autoGrow) text.textAutoResize = "WIDTH_AND_HEIGHT";
                                    node = text;
                                }

                                if (node) {
                                    node.name = layer.name || layer.type;
                                    if (layer.layoutAlign && "layoutAlign" in node) {
                                        const val = layer.layoutAlign.toUpperCase();
                                        if (val === "STRETCH") (node as any).layoutAlign = "STRETCH";
                                        else if (val === "INHERIT") (node as any).layoutAlign = "INHERIT";
                                    }
                                    if (layer.layoutGrow !== undefined && "layoutGrow" in node) {
                                        (node as any).layoutGrow = normalizeLayoutGrow(layer.layoutGrow);
                                    }
                                    if ("cornerRadius" in node && layer.cornerRadius) (node as any).cornerRadius = layer.cornerRadius;
                                    if ("strokes" in node && layer.strokeColor) {
                                        (node as any).strokes = [createSolidPaint(layer.strokeColor)];
                                        (node as any).strokeWeight = layer.strokeWeight || 1;
                                    }
                                    if ("opacity" in node && layer.opacity !== undefined) (node as any).opacity = layer.opacity;
                                    const effects: Effect[] = [];
                                    if (layer.shadow) {
                                        effects.push({ type: "DROP_SHADOW", color: layer.shadowColor || { r: 0, g: 0, b: 0, a: 0.2 }, offset: layer.shadowOffset || { x: 0, y: 4 }, radius: layer.shadowRadius || layer.shadowBlur || 4, visible: true, blendMode: "NORMAL" });
                                    }
                                    if (layer.blur) effects.push({ type: "LAYER_BLUR", radius: layer.blur, visible: true } as Effect);
                                    if ("effects" in node && effects.length > 0) (node as any).effects = effects;

                                    parent.appendChild(node);

                                    const children = layer.children || layer.layers;
                                    if (children && layer.type === "FRAME") {
                                        for (const child of children) {
                                            await (createLayerInner as any)(child, node as FrameNode);
                                        }
                                    }
                                }
                            })(layer, parent);
                        }

                        if (msg.enableDesignSystem) {
                            await applyDesignSystemMode(msg.appColor);
                            applyStyleTokensToNodes(parentFrame);
                        }
                        if (msg.enableComponents) {
                            buildReusableComponents(parentFrame);
                        }
                        if (msg.enableResponsivePass) {
                            applyResponsivePass(parentFrame, screenLayout);
                        }
                        renderedFrames.push(parentFrame);

                        figma.currentPage.selection = [parentFrame];
                        figma.viewport.scrollAndZoomIntoView([parentFrame]);
                        figma.notify("Design generated and drawn!");
                        figma.ui.postMessage({ type: "design-drawn" });
                        const findings = analyzeLayoutQA(designData);
                        figma.ui.postMessage({
                            type: "qa-report",
                            findings:
                                findings.length > 0
                                    ? findings
                                    : ["No major layout issues detected."],
                        });

                        offset += 60; // small offset so duplicates don't stack exactly
                    }
                    if (msg.enableFlowLinks) {
                        linkFlowFrames(renderedFrames);
                    }
                } else {
                    // Single target or no contextIds: behave like before (create single frame or replace single context)
                    let parentFrame: FrameNode;

                    if (msg.replaceContext && msg.contextId) {
                        const existingNode = figma.getNodeById(msg.contextId) as FrameNode;
                        if (existingNode && existingNode.type === "FRAME") {
                            parentFrame = existingNode;
                            parentFrame.name = designName;
                            parentFrame.children.forEach((child) => child.remove());
                            figma.notify("Updating existing frame...");
                        } else {
                            parentFrame = figma.createFrame();
                            parentFrame.name = designName;
                            parentFrame.x = figma.viewport.center.x;
                            parentFrame.y = figma.viewport.center.y;
                            figma.currentPage.appendChild(parentFrame);
                        }
                    } else {
                        parentFrame = figma.createFrame();
                        parentFrame.name = designName;
                        parentFrame.x = figma.viewport.center.x;
                        parentFrame.y = figma.viewport.center.y;
                        figma.currentPage.appendChild(parentFrame);
                    }

                    if (!msg.replaceContext) {
                        parentFrame.layoutMode = "NONE";
                        parentFrame.resize(
                            defaultFrameSize.width,
                            defaultFrameSize.height,
                        );
                    }

                    const createSolidPaint = (color: any): SolidPaint => {
                        return {
                            type: "SOLID",
                            color: { r: color.r, g: color.g, b: color.b },
                            opacity:
                                color.a !== undefined
                                    ? color.a
                                    : color.opacity !== undefined
                                      ? color.opacity
                                      : 1,
                        };
                    };

                    const screensToRender =
                        !msg.replaceContext && msg.outputMode === "flow"
                            ? normalizedScreens.slice(0, requestedScreenCount)
                            : [normalizedScreens[0]];
                    if (
                        msg.outputMode === "flow" &&
                        normalizedScreens.length < requestedScreenCount
                    ) {
                        figma.notify(
                            `Generated ${normalizedScreens.length}/${requestedScreenCount} screens from AI response.`,
                        );
                    }
                    let screenOffset = 0;
                    const renderedFrames: FrameNode[] = [];
                    for (const screen of screensToRender) {
                        if (!msg.replaceContext) {
                            parentFrame.name = `${designName} - ${screen.name || `Screen ${screenOffset + 1}`}`;
                            const screenWidth = Number(screen?.width) || defaultFrameSize.width;
                            const screenHeight = Number(screen?.height) || defaultFrameSize.height;
                            parentFrame.resize(screenWidth, screenHeight);
                        }
                        for (const layer of screen.layers || []) {
                        await (async function createLayerSingle(
                            layer: any,
                            parent: BaseNode & ChildrenMixin,
                        ) {
                            let node: SceneNode | null = null;

                            if (layer.type === "FRAME") {
                                const frame = figma.createFrame();
                                frame.resize(layer.width || 100, layer.height || 100);
                                frame.x = layer.x || 0;
                                frame.y = layer.y || 0;
                                if (layer.fills) frame.fills = layer.fills;
                                else if (layer.color)
                                    frame.fills = [createSolidPaint(layer.color)];
                                else frame.fills = [];
                                if (layer.layoutMode) {
                                    frame.layoutMode = layer.layoutMode;
                                    const pAlign = layer.primaryAxisAlignItems
                                        ? layer.primaryAxisAlignItems.toUpperCase()
                                        : "MIN";
                                    if (
                                        ["MIN", "MAX", "CENTER", "SPACE_BETWEEN"].includes(
                                            pAlign,
                                        )
                                    )
                                        frame.primaryAxisAlignItems = pAlign as any;
                                    const cAlign = layer.counterAxisAlignItems
                                        ? layer.counterAxisAlignItems.toUpperCase()
                                        : "MIN";
                                    if (
                                        ["MIN", "MAX", "CENTER", "BASELINE"].includes(
                                            cAlign,
                                        )
                                    )
                                        frame.counterAxisAlignItems = cAlign as any;
                                    frame.itemSpacing = layer.itemSpacing || 0;
                                    frame.paddingTop = layer.paddingTop || layer.padding || 0;
                                    frame.paddingBottom =
                                        layer.paddingBottom || layer.padding || 0;
                                    frame.paddingLeft = layer.paddingLeft || layer.padding || 0;
                                    frame.paddingRight =
                                        layer.paddingRight || layer.padding || 0;
                                    if (layer.primaryAxisSizingMode) {
                                        const pSize =
                                            layer.primaryAxisSizingMode.toUpperCase();
                                        if (pSize === "FIXED" || pSize === "AUTO")
                                            frame.primaryAxisSizingMode = pSize as any;
                                    }
                                    if (layer.counterAxisSizingMode) {
                                        const cSize =
                                            layer.counterAxisSizingMode.toUpperCase();
                                        if (cSize === "FIXED" || cSize === "AUTO")
                                            frame.counterAxisSizingMode = cSize as any;
                                    }
                                }
                                node = frame;
                            } else if (layer.type === "RECTANGLE" || layer.type === "IMAGE") {
                                const rect = figma.createRectangle();
                                rect.resize(layer.width || 100, layer.height || 100);
                                rect.x = layer.x || 0;
                                rect.y = layer.y || 0;
                                if (layer.type === "IMAGE") {
                                    rect.fills = [
                                        { type: "SOLID", color: { r: 0.85, g: 0.85, b: 0.85 } },
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
                                            createSolidPaint(layer.color || { r: 0.5, g: 0.5, b: 0.5 }),
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
                                        createSolidPaint(layer.color || { r: 0.5, g: 0.5, b: 0.5 }),
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
                                    createSolidPaint(layer.color || { r: 1, g: 0.8, b: 0 }),
                                ];
                                node = star;
                            } else if (layer.type === "POLYGON") {
                                const poly = figma.createPolygon();
                                poly.resize(layer.width || 100, layer.height || 100);
                                poly.x = layer.x || 0;
                                poly.y = layer.y || 0;
                                poly.fills = [
                                    createSolidPaint(layer.color || { r: 0.5, g: 0.5, b: 0.5 }),
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
                                await figma
                                    .loadFontAsync(fontName)
                                    .catch(() =>
                                        figma.loadFontAsync({
                                            family: "Inter",
                                            style: "Regular",
                                        }),
                                    );
                                const text = figma.createText();
                                text.fontName = fontName;
                                text.x = layer.x || 0;
                                text.y = layer.y || 0;
                                text.characters = layer.text || "Text";
                                text.fontSize = layer.fontSize || 14;
                                if (layer.color) text.fills = [createSolidPaint(layer.color)];
                                if (layer.textAlignHorizontal)
                                    text.textAlignHorizontal = layer.textAlignHorizontal;
                                if (layer.textAlignVertical)
                                    text.textAlignVertical = layer.textAlignVertical;
                                if (layer.width) text.resize(layer.width, text.height);
                                if (layer.autoGrow) text.textAutoResize = "WIDTH_AND_HEIGHT";
                                node = text;
                            }

                            if (node) {
                                node.name = layer.name || layer.type;
                                if (layer.layoutAlign && "layoutAlign" in node) {
                                    const val = layer.layoutAlign.toUpperCase();
                                    if (val === "STRETCH") (node as any).layoutAlign = "STRETCH";
                                    else if (val === "INHERIT")
                                        (node as any).layoutAlign = "INHERIT";
                                }
                                if (layer.layoutGrow !== undefined && "layoutGrow" in node) {
                                    (node as any).layoutGrow = normalizeLayoutGrow(
                                        layer.layoutGrow,
                                    );
                                }
                                if ("cornerRadius" in node && layer.cornerRadius)
                                    (node as any).cornerRadius = layer.cornerRadius;
                                if ("strokes" in node && layer.strokeColor) {
                                    (node as any).strokes = [createSolidPaint(layer.strokeColor)];
                                    (node as any).strokeWeight = layer.strokeWeight || 1;
                                }
                                if ("opacity" in node && layer.opacity !== undefined)
                                    (node as any).opacity = layer.opacity;
                                const effects: Effect[] = [];
                                if (layer.shadow)
                                    effects.push({
                                        type: "DROP_SHADOW",
                                        color: layer.shadowColor || {
                                            r: 0,
                                            g: 0,
                                            b: 0,
                                            a: 0.2,
                                        },
                                        offset: layer.shadowOffset || { x: 0, y: 4 },
                                        radius:
                                            layer.shadowRadius || layer.shadowBlur || 4,
                                        visible: true,
                                        blendMode: "NORMAL",
                                    });
                                if (layer.blur)
                                    effects.push({
                                        type: "LAYER_BLUR",
                                        radius: layer.blur,
                                        visible: true,
                                    } as Effect);
                                if ("effects" in node && effects.length > 0)
                                    (node as any).effects = effects;
                                parent.appendChild(node);
                                const children = layer.children || layer.layers;
                                if (children && layer.type === "FRAME") {
                                    for (const child of children) {
                                        await (createLayerSingle as any)(child, node as FrameNode);
                                    }
                                }
                            }
                        })(layer, parentFrame);
                        }
                        if (!msg.replaceContext && screensToRender.length > 1) {
                            renderedFrames.push(parentFrame);
                            const next = figma.createFrame();
                            next.name = designName;
                            next.layoutMode = "NONE";
                            next.x = parentFrame.x + (Number(parentFrame.width) || defaultFrameSize.width) + 120;
                            next.y = parentFrame.y;
                            figma.currentPage.appendChild(next);
                            parentFrame = next;
                        }
                        screenOffset += 1;
                    }
                    if (!renderedFrames.includes(parentFrame)) {
                        renderedFrames.push(parentFrame);
                    }

                    if (msg.enableDesignSystem) {
                        await applyDesignSystemMode(msg.appColor);
                        renderedFrames.forEach((f) => applyStyleTokensToNodes(f));
                    }
                    if (msg.enableComponents) {
                        renderedFrames.forEach((f) => buildReusableComponents(f));
                    }
                    if (msg.enableResponsivePass) {
                        renderedFrames.forEach((f) =>
                            applyResponsivePass(f, screenLayout),
                        );
                    }
                    if (msg.enableFlowLinks && msg.outputMode === "flow") {
                        linkFlowFrames(renderedFrames);
                    }

                    figma.currentPage.selection = [parentFrame];
                    figma.viewport.scrollAndZoomIntoView([parentFrame]);
                    figma.notify("Design generated and drawn!");
                    figma.ui.postMessage({ type: "design-drawn" });
                    const findings = analyzeLayoutQA(designData);
                    figma.ui.postMessage({
                        type: "qa-report",
                        findings:
                            findings.length > 0
                                ? findings
                                : ["No major layout issues detected."],
                    });
                }
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
