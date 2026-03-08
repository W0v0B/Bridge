import { theme as antdTheme } from "antd";

export type ThemeId = "snow" | "dark" | "rose" | "arctic" | "violet" | "nord";

// The algorithm type antd accepts in ConfigProvider
type Algorithm = typeof antdTheme.defaultAlgorithm | typeof antdTheme.darkAlgorithm;

export interface AppTheme {
  id: ThemeId;
  label: string;
  swatch: string;    // accent color shown in picker
  bgSwatch: string;  // background color shown in picker
  isDark: boolean;
  css: Record<string, string>;
  antdAlgorithm: Algorithm;
  antdToken: {
    colorPrimary: string;
    colorBgContainer: string;
    colorBgElevated: string;
    colorBgLayout: string;
    colorBorder: string;
    borderRadius: number;
  };
}

export const THEMES: Record<ThemeId, AppTheme> = {
  snow: {
    id: "snow",
    label: "Snow",
    swatch: "#1677ff",
    bgSwatch: "#ffffff",
    isDark: false,
    css: {
      "--tb-bg":               "#ffffff",
      "--sidebar-bg":          "#ffffff",
      "--content-bg":          "#ffffff",
      "--border":              "#f0f0f0",
      "--accent":              "#1677ff",
      "--accent-hover":        "#4096ff",
      "--text-primary":        "rgba(0,0,0,0.88)",
      "--text-secondary":      "#8c8c8c",
      "--selected-bg":         "#e6f4ff",
      "--wc-hover":            "rgba(0,0,0,0.06)",
      "--wc-close-hover":      "#e81123",
      "--wc-close-hover-text": "#ffffff",
      "--scrollbar-thumb":     "#d9d9d9",
      "--scrollbar-thumb-hover": "#bfbfbf",
      "--card-bg":             "#f5f5f5",
      "--term-bg":             "#1e1e1e",
      "--term-header-bg":      "#2d2d2d",
      "--term-border":         "#404040",
      "--term-text":           "#d4d4d4",
      "--term-prompt":         "#6a9955",
    },
    antdAlgorithm: antdTheme.defaultAlgorithm,
    antdToken: {
      colorPrimary:    "#1677ff",
      colorBgContainer: "#ffffff",
      colorBgElevated: "#ffffff",
      colorBgLayout:   "#f5f5f5",
      colorBorder:     "#d9d9d9",
      borderRadius:    6,
    },
  },

  dark: {
    id: "dark",
    label: "Dark Modern",
    swatch: "#007acc",
    bgSwatch: "#1e1e1e",
    isDark: true,
    css: {
      "--tb-bg":               "#323233",
      "--sidebar-bg":          "#252526",
      "--content-bg":          "#1e1e1e",
      "--border":              "#3c3c3c",
      "--accent":              "#007acc",
      "--accent-hover":        "#1a9ad6",
      "--text-primary":        "#cccccc",
      "--text-secondary":      "#858585",
      "--selected-bg":         "#04395e",
      "--wc-hover":            "rgba(255,255,255,0.1)",
      "--wc-close-hover":      "#e81123",
      "--wc-close-hover-text": "#ffffff",
      "--scrollbar-thumb":     "#424242",
      "--scrollbar-thumb-hover": "#5a5a5a",
      "--card-bg":             "#2a2a2b",
      "--term-bg":             "#1e1e1e",
      "--term-header-bg":      "#252526",
      "--term-border":         "#3c3c3c",
      "--term-text":           "#d4d4d4",
      "--term-prompt":         "#4ec9b0",
    },
    antdAlgorithm: antdTheme.darkAlgorithm,
    antdToken: {
      colorPrimary:    "#007acc",
      colorBgContainer: "#252526",
      colorBgElevated: "#2d2d2d",
      colorBgLayout:   "#1e1e1e",
      colorBorder:     "#454545",
      borderRadius:    6,
    },
  },

  rose: {
    id: "rose",
    label: "Rose",
    swatch: "#f06090",
    bgSwatch: "#191324",
    isDark: true,
    css: {
      "--tb-bg":               "#2a1e35",
      "--sidebar-bg":          "#21172c",
      "--content-bg":          "#191324",
      "--border":              "#3e2d4a",
      "--accent":              "#f06090",
      "--accent-hover":        "#f57fab",
      "--text-primary":        "#e0d0ec",
      "--text-secondary":      "#a090b0",
      "--selected-bg":         "#3d1a35",
      "--wc-hover":            "rgba(240,96,144,0.15)",
      "--wc-close-hover":      "#e81123",
      "--wc-close-hover-text": "#ffffff",
      "--scrollbar-thumb":     "#4a3055",
      "--scrollbar-thumb-hover": "#6a4075",
      "--card-bg":             "#271930",
      "--term-bg":             "#191324",
      "--term-header-bg":      "#21172c",
      "--term-border":         "#3e2d4a",
      "--term-text":           "#e0d0ec",
      "--term-prompt":         "#f06090",
    },
    antdAlgorithm: antdTheme.darkAlgorithm,
    antdToken: {
      colorPrimary:    "#f06090",
      colorBgContainer: "#21172c",
      colorBgElevated: "#2d2040",
      colorBgLayout:   "#191324",
      colorBorder:     "#3e2d4a",
      borderRadius:    6,
    },
  },

  arctic: {
    id: "arctic",
    label: "Arctic",
    swatch: "#63c2b8",
    bgSwatch: "#13202e",
    isDark: true,
    css: {
      "--tb-bg":               "#1e2d3a",
      "--sidebar-bg":          "#182433",
      "--content-bg":          "#13202e",
      "--border":              "#2a3d4f",
      "--accent":              "#63c2b8",
      "--accent-hover":        "#85d0c8",
      "--text-primary":        "#c8dde8",
      "--text-secondary":      "#7a9aaa",
      "--selected-bg":         "#1a3d45",
      "--wc-hover":            "rgba(99,194,184,0.15)",
      "--wc-close-hover":      "#e81123",
      "--wc-close-hover-text": "#ffffff",
      "--scrollbar-thumb":     "#2a4555",
      "--scrollbar-thumb-hover": "#3a5a6a",
      "--card-bg":             "#1c2d3a",
      "--term-bg":             "#13202e",
      "--term-header-bg":      "#182433",
      "--term-border":         "#2a3d4f",
      "--term-text":           "#c8dde8",
      "--term-prompt":         "#63c2b8",
    },
    antdAlgorithm: antdTheme.darkAlgorithm,
    antdToken: {
      colorPrimary:    "#63c2b8",
      colorBgContainer: "#182433",
      colorBgElevated: "#1e3244",
      colorBgLayout:   "#13202e",
      colorBorder:     "#2a3d4f",
      borderRadius:    6,
    },
  },

  violet: {
    id: "violet",
    label: "Violet",
    swatch: "#8a70fa",
    bgSwatch: "#11101c",
    isDark: true,
    css: {
      "--tb-bg":               "#1f1a2e",
      "--sidebar-bg":          "#181426",
      "--content-bg":          "#11101c",
      "--border":              "#332a4a",
      "--accent":              "#8a70fa",
      "--accent-hover":        "#a088fb",
      "--text-primary":        "#cac0e8",
      "--text-secondary":      "#7060a0",
      "--selected-bg":         "#2a1e50",
      "--wc-hover":            "rgba(138,112,250,0.15)",
      "--wc-close-hover":      "#e81123",
      "--wc-close-hover-text": "#ffffff",
      "--scrollbar-thumb":     "#3a2a5a",
      "--scrollbar-thumb-hover": "#4a3a7a",
      "--card-bg":             "#1c1830",
      "--term-bg":             "#11101c",
      "--term-header-bg":      "#181426",
      "--term-border":         "#332a4a",
      "--term-text":           "#cac0e8",
      "--term-prompt":         "#8a70fa",
    },
    antdAlgorithm: antdTheme.darkAlgorithm,
    antdToken: {
      colorPrimary:    "#8a70fa",
      colorBgContainer: "#181426",
      colorBgElevated: "#201a38",
      colorBgLayout:   "#11101c",
      colorBorder:     "#332a4a",
      borderRadius:    6,
    },
  },

  nord: {
    id: "nord",
    label: "Nord",
    swatch: "#88c0d0",
    bgSwatch: "#2e3440",
    isDark: true,
    css: {
      "--tb-bg":               "#3b4252",
      "--sidebar-bg":          "#2e3440",
      "--content-bg":          "#2e3440",
      "--border":              "#4c566a",
      "--accent":              "#88c0d0",
      "--accent-hover":        "#8fbcbb",
      "--text-primary":        "#eceff4",
      "--text-secondary":      "#7b8b9e",
      "--selected-bg":         "#3d5066",
      "--wc-hover":            "rgba(255,255,255,0.08)",
      "--wc-close-hover":      "#bf616a",
      "--wc-close-hover-text": "#eceff4",
      "--scrollbar-thumb":     "#4c566a",
      "--scrollbar-thumb-hover": "#5e6b7d",
      "--card-bg":             "#373e4d",
      "--term-bg":             "#2e3440",
      "--term-header-bg":      "#3b4252",
      "--term-border":         "#4c566a",
      "--term-text":           "#eceff4",
      "--term-prompt":         "#88c0d0",
    },
    antdAlgorithm: antdTheme.darkAlgorithm,
    antdToken: {
      colorPrimary:    "#88c0d0",
      colorBgContainer: "#3b4252",
      colorBgElevated: "#434c5e",
      colorBgLayout:   "#2e3440",
      colorBorder:     "#4c566a",
      borderRadius:    6,
    },
  },
};

export const THEME_ORDER: ThemeId[] = ["snow", "dark", "rose", "arctic", "violet", "nord"];
