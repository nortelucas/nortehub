export type MeasuredProfileCategory =
  | "flatBar"
  | "angleUnequal"
  | "angleEqual"
  | "profileU"
  | "profileT"
  | "roundTube"
  | "rectTube"
  | "squareTube";

export interface CatalogedMeasuredProfile {
  code: string;
  title: string;
  category: MeasuredProfileCategory;
  inchMeasures: string[];
  mmMeasures: number[];
  weightKgM: number;
}

export const catalogedMeasuredProfiles: CatalogedMeasuredProfile[] = [
  { code: "BAR010", title: "BARRAS CHATAS", category: "flatBar", inchMeasures: ["5/8", "3/16"], mmMeasures: [15.88, 4.76], weightKgM: 0.204 },
  { code: "BAR012", title: "BARRAS CHATAS", category: "flatBar", inchMeasures: ["1/2", "1/8"], mmMeasures: [12.70, 3.18], weightKgM: 0.109 },
  { code: "BAR013", title: "BARRAS CHATAS", category: "flatBar", inchMeasures: ["5/8", "1/8"], mmMeasures: [15.87, 3.18], weightKgM: 0.136 },
  { code: "BAR014", title: "BARRAS CHATAS", category: "flatBar", inchMeasures: ["3/4", "1/8"], mmMeasures: [19.05, 3.17], weightKgM: 0.163 },
  { code: "BAR015", title: "BARRAS CHATAS", category: "flatBar", inchMeasures: ["7/8", "1/8"], mmMeasures: [22.20, 3.17], weightKgM: 0.191 },
  { code: "BAR016", title: "BARRAS CHATAS", category: "flatBar", inchMeasures: ["1", "1/8"], mmMeasures: [25.40, 3.18], weightKgM: 0.217 },
  { code: "BAR019", title: "BARRAS CHATAS", category: "flatBar", inchMeasures: ["1.1/4", "1/8"], mmMeasures: [31.75, 3.17], weightKgM: 0.272 },
  { code: "BAR022", title: "BARRAS CHATAS", category: "flatBar", inchMeasures: ["1.1/2", "1/8"], mmMeasures: [38.10, 3.18], weightKgM: 0.329 },
  { code: "BAR027", title: "BARRAS CHATAS", category: "flatBar", inchMeasures: ["2", "1/8"], mmMeasures: [50.80, 3.18], weightKgM: 0.436 },
  { code: "BAR032", title: "BARRAS CHATAS", category: "flatBar", inchMeasures: ["3", "1/8"], mmMeasures: [76.20, 3.18], weightKgM: 0.654 },
  { code: "BAR047", title: "BARRAS CHATAS", category: "flatBar", inchMeasures: ["1/2", "3/16"], mmMeasures: [12.70, 4.76], weightKgM: 0.163 },
  { code: "BAR049", title: "BARRAS CHATAS", category: "flatBar", inchMeasures: ["5/8", "3/16"], mmMeasures: [15.87, 4.76], weightKgM: 0.204 },
  { code: "BAR050", title: "BARRAS CHATAS", category: "flatBar", inchMeasures: ["3/4", "3/16"], mmMeasures: [19.05, 4.76], weightKgM: 0.245 },
  { code: "BAR053", title: "BARRAS CHATAS", category: "flatBar", inchMeasures: ["1", "3/16"], mmMeasures: [25.40, 4.76], weightKgM: 0.327 },
  { code: "BAR054", title: "BARRAS CHATAS", category: "flatBar", inchMeasures: ["1.1/4", "3/16"], mmMeasures: [31.75, 4.76], weightKgM: 0.409 },
  { code: "BAR057", title: "BARRAS CHATAS", category: "flatBar", inchMeasures: ["1.1/2", "3/16"], mmMeasures: [38.10, 4.76], weightKgM: 0.490 },
  { code: "BAR086", title: "BARRAS CHATAS", category: "flatBar", inchMeasures: ["1/2", "1/4"], mmMeasures: [12.70, 6.35], weightKgM: 0.218 },
  { code: "BAR089", title: "BARRAS CHATAS", category: "flatBar", inchMeasures: ["3/4", "1/4"], mmMeasures: [19.05, 6.35], weightKgM: 0.326 },
  { code: "BAR091", title: "BARRAS CHATAS", category: "flatBar", inchMeasures: ["1", "1/4"], mmMeasures: [25.40, 6.35], weightKgM: 0.435 },
  { code: "BAR093", title: "BARRAS CHATAS", category: "flatBar", inchMeasures: ["1.1/4", "1/4"], mmMeasures: [31.75, 6.35], weightKgM: 0.544 },
  { code: "BAR100", title: "BARRAS CHATAS", category: "flatBar", inchMeasures: ["2", "1/4"], mmMeasures: [50.80, 6.35], weightKgM: 0.870 },

  { code: "L093", title: "CANTONEIRAS DE ABAS DESIGUAIS", category: "angleUnequal", inchMeasures: ["1", "1/2", "1/8"], mmMeasures: [25.40, 12.70, 3.20], weightKgM: 0.300 },
  { code: "L100", title: "CANTONEIRAS DE ABAS DESIGUAIS", category: "angleUnequal", inchMeasures: ["1.1/2", "1", "1/8"], mmMeasures: [38.10, 25.40, 3.20], weightKgM: 0.521 },
  { code: "L104", title: "CANTONEIRAS DE ABAS DESIGUAIS", category: "angleUnequal", inchMeasures: ["2", "1", "1/8"], mmMeasures: [50.80, 25.40, 3.20], weightKgM: 0.688 },
  { code: "CT209", title: "CANTONEIRAS DE ABAS DESIGUAIS", category: "angleUnequal", inchMeasures: [], mmMeasures: [32, 16.2, 1.20], weightKgM: 0.153 },

  { code: "L002", title: "CANTONEIRAS DE ABAS IGUAIS", category: "angleEqual", inchMeasures: ["1/2", "1/16"], mmMeasures: [12.70, 1.58], weightKgM: 1.102 },
  { code: "L009", title: "CANTONEIRAS DE ABAS IGUAIS", category: "angleEqual", inchMeasures: ["3/4", "1/16"], mmMeasures: [19.05, 1.58], weightKgM: 0.157 },
  { code: "L011", title: "CANTONEIRAS DE ABAS IGUAIS", category: "angleEqual", inchMeasures: ["3/4", "1/8"], mmMeasures: [19.05, 3.18], weightKgM: 0.290 },
  { code: "L013", title: "CANTONEIRAS DE ABAS IGUAIS", category: "angleEqual", inchMeasures: ["1", "1/16"], mmMeasures: [25.40, 1.58], weightKgM: 0.211 },
  { code: "L014", title: "CANTONEIRAS DE ABAS IGUAIS", category: "angleEqual", inchMeasures: ["1", "1/8"], mmMeasures: [25.40, 3.18], weightKgM: 0.409 },
  { code: "L018", title: "CANTONEIRAS DE ABAS IGUAIS", category: "angleEqual", inchMeasures: ["1.1/4", "1/8"], mmMeasures: [31.75, 3.20], weightKgM: 0.409 },
  { code: "L022", title: "CANTONEIRAS DE ABAS IGUAIS", category: "angleEqual", inchMeasures: ["1.1/2", "1/8"], mmMeasures: [38.10, 3.18], weightKgM: 0.626 },
  { code: "L023", title: "CANTONEIRAS DE ABAS IGUAIS", category: "angleEqual", inchMeasures: ["1.1/2", "3/16"], mmMeasures: [38.10, 4.76], weightKgM: 0.915 },
  { code: "L025", title: "CANTONEIRAS DE ABAS IGUAIS", category: "angleEqual", inchMeasures: ["2", "1/8"], mmMeasures: [50.80, 3.18], weightKgM: 0.539 },
  { code: "L026", title: "CANTONEIRAS DE ABAS IGUAIS", category: "angleEqual", inchMeasures: ["2", "3/16"], mmMeasures: [50.80, 4.76], weightKgM: 1.249 },
  { code: "L405", title: "CANTONEIRAS DE ABAS IGUAIS", category: "angleEqual", inchMeasures: ["5/8", "1/16"], mmMeasures: [15.87, 1.60], weightKgM: 0.130 },
  { code: "L612", title: "CANTONEIRAS DE ABAS IGUAIS", category: "angleEqual", inchMeasures: ["2"], mmMeasures: [50.80, 2.00], weightKgM: 0.539 },
  { code: "L744", title: "CANTONEIRAS DE ABAS IGUAIS", category: "angleEqual", inchMeasures: ["1.1/2", "1/16"], mmMeasures: [38.10, 1.57], weightKgM: 0.317 },

  { code: "U036", title: "PERFIS U", category: "profileU", inchMeasures: ["3/8", "3/8", "1/16"], mmMeasures: [9.52, 9.52, 1.58], weightKgM: 0.108 },
  { code: "U037", title: "PERFIS U", category: "profileU", inchMeasures: ["3/8", "1/2", "1/16"], mmMeasures: [9.52, 12.70, 1.60], weightKgM: 0.138 },
  { code: "U044", title: "PERFIS U", category: "profileU", inchMeasures: ["1/2", "1/2", "1/16"], mmMeasures: [12.70, 12.70, 1.58], weightKgM: 0.149 },
  { code: "U058", title: "PERFIS U", category: "profileU", inchMeasures: ["3/4", "3/4", "3/32"], mmMeasures: [19.05, 19.05, 2.38], weightKgM: 0.336 },
  { code: "U064", title: "PERFIS U", category: "profileU", inchMeasures: ["7/8", "7/8"], mmMeasures: [22.20, 22.20, 2.40], weightKgM: 0.367 },
  { code: "U509", title: "PERFIS U", category: "profileU", inchMeasures: ["5/8", "5/8", "1/16"], mmMeasures: [15.87, 15.87, 1.58], weightKgM: 0.190 },
  { code: "U555", title: "PERFIS U", category: "profileU", inchMeasures: ["1", "5/8"], mmMeasures: [25.00, 16.00, 1.30], weightKgM: 0.220 },
  { code: "U555 B", title: "PERFIS U", category: "profileU", inchMeasures: [], mmMeasures: [22.00, 11.00, 1.00], weightKgM: 0.144 },
  { code: "T076", title: "PERFIS T", category: "profileT", inchMeasures: ["1", "1/16"], mmMeasures: [25.40, 1.60], weightKgM: 0.213 },

  { code: "TUB001", title: "TUBOS REDONDOS", category: "roundTube", inchMeasures: ["3/4"], mmMeasures: [19.05, 1.00], weightKgM: 0.153 },
  { code: "TUB003", title: "TUBOS REDONDOS", category: "roundTube", inchMeasures: ["3/8", "1/16"], mmMeasures: [9.52, 1.58], weightKgM: 0.108 },
  { code: "TUB009", title: "TUBOS REDONDOS", category: "roundTube", inchMeasures: ["1/2"], mmMeasures: [12.70, 1.24], weightKgM: 0.117 },
  { code: "TUB017", title: "TUBOS REDONDOS", category: "roundTube", inchMeasures: ["5/8"], mmMeasures: [15.88, 1.00], weightKgM: 0.124 },
  { code: "TUB019", title: "TUBOS REDONDOS", category: "roundTube", inchMeasures: ["5/8", "1/16"], mmMeasures: [15.87, 1.58], weightKgM: 0.191 },
  { code: "TUB026", title: "TUBOS REDONDOS", category: "roundTube", inchMeasures: ["3/4"], mmMeasures: [19.05, 1.00], weightKgM: 0.153 },
  { code: "TUB027", title: "TUBOS REDONDOS", category: "roundTube", inchMeasures: ["3/4"], mmMeasures: [19.05, 1.20], weightKgM: 0.181 },
  { code: "TUB028", title: "TUBOS REDONDOS", category: "roundTube", inchMeasures: ["3/4", "1/16"], mmMeasures: [19.05, 1.58], weightKgM: 0.234 },
  { code: "TUB036", title: "TUBOS REDONDOS", category: "roundTube", inchMeasures: ["7/8"], mmMeasures: [22.22, 1.00], weightKgM: 0.180 },
  { code: "TUB038", title: "TUBOS REDONDOS", category: "roundTube", inchMeasures: ["7/8", "1/16"], mmMeasures: [22.22, 1.58], weightKgM: 0.276 },
  { code: "TUB044", title: "TUBOS REDONDOS", category: "roundTube", inchMeasures: ["1"], mmMeasures: [25.40, 0.90], weightKgM: 0.187 },
  { code: "TUB046", title: "TUBOS REDONDOS", category: "roundTube", inchMeasures: ["1", "1/16"], mmMeasures: [25.40, 1.58], weightKgM: 0.319 },
  { code: "TUB058", title: "TUBOS REDONDOS", category: "roundTube", inchMeasures: ["1.1/4", "1/16"], mmMeasures: [31.75, 1.58], weightKgM: 0.404 },
  { code: "TUB069", title: "TUBOS REDONDOS", category: "roundTube", inchMeasures: ["1.1/2"], mmMeasures: [38.10, 1.50], weightKgM: 0.467 },
  { code: "TUB091", title: "TUBOS REDONDOS", category: "roundTube", inchMeasures: ["2"], mmMeasures: [50.50, 2.00], weightKgM: 0.826 },
  { code: "TUB502", title: "TUBOS REDONDOS", category: "roundTube", inchMeasures: ["2"], mmMeasures: [50.80, 1.27], weightKgM: 0.535 },
  { code: "TUB503", title: "TUBOS REDONDOS", category: "roundTube", inchMeasures: ["3"], mmMeasures: [76.20, 1.27], weightKgM: 0.810 },
  { code: "TUB504", title: "TUBOS REDONDOS", category: "roundTube", inchMeasures: ["4"], mmMeasures: [101.60, 1.50], weightKgM: 1.095 },
  { code: "TUB610", title: "TUBOS REDONDOS", category: "roundTube", inchMeasures: ["2", "1/16"], mmMeasures: [50.80, 1.58], weightKgM: 0.591 },

  { code: "TUB4501", title: "TUBOS RETANGULARES", category: "rectTube", inchMeasures: ["1", "1/2"], mmMeasures: [25.40, 12.70, 1.15], weightKgM: 0.223 },
  { code: "TUB4504", title: "TUBOS RETANGULARES", category: "rectTube", inchMeasures: ["2", "1"], mmMeasures: [50.80, 25.40, 2.00], weightKgM: 0.784 },
  { code: "TUB4509", title: "TUBOS RETANGULARES", category: "rectTube", inchMeasures: [], mmMeasures: [30.00, 20.00, 2.00], weightKgM: 0.499 },
  { code: "TUB4513", title: "TUBOS RETANGULARES", category: "rectTube", inchMeasures: ["2", "1.1/2"], mmMeasures: [50.80, 38.10, 2.00], weightKgM: 0.912 },
  { code: "TUB4517", title: "TUBOS RETANGULARES", category: "rectTube", inchMeasures: ["3", "1.1/2"], mmMeasures: [76.20, 38.10, 2.00], weightKgM: 1.190 },
  { code: "TUB4520", title: "TUBOS RETANGULARES", category: "rectTube", inchMeasures: ["6", "1.1/2"], mmMeasures: [152.40, 38.10, 3.20], weightKgM: 3.181 },
  { code: "TUB4530", title: "TUBOS RETANGULARES", category: "rectTube", inchMeasures: ["4", "2"], mmMeasures: [101.60, 50.80, 3.05], weightKgM: 2.418 },
  { code: "TUB4536", title: "TUBOS RETANGULARES", category: "rectTube", inchMeasures: ["2", "1/2"], mmMeasures: [50.80, 12.70, 1.30], weightKgM: 0.428 },
  { code: "TUB4537", title: "TUBOS RETANGULARES", category: "rectTube", inchMeasures: ["4", "1.1/2"], mmMeasures: [101.60, 38.10, 2.50], weightKgM: 1.827 },
  { code: "TUB4543", title: "TUBOS RETANGULARES", category: "rectTube", inchMeasures: ["2.3/8", "1.1/2"], mmMeasures: [60.33, 38.10, 1.70], weightKgM: 0.875 },
  { code: "TUB4545L", title: "TUBOS RETANGULARES", category: "rectTube", inchMeasures: ["1.1/2", "1"], mmMeasures: [38.10, 25.40, 1.20], weightKgM: 0.397 },
  { code: "TUB4559", title: "TUBOS RETANGULARES", category: "rectTube", inchMeasures: ["6", "2"], mmMeasures: [152.40, 50.80, 3.00], weightKgM: 3.206 },
  { code: "TUB4563", title: "TUBOS RETANGULARES", category: "rectTube", inchMeasures: ["2", "1"], mmMeasures: [50.80, 25.40, 1.20], weightKgM: 0.482 },
  { code: "TUB4599", title: "TUBOS RETANGULARES", category: "rectTube", inchMeasures: ["4", "2"], mmMeasures: [101.60, 50.80, 1.69], weightKgM: 1.366 },

  { code: "TUB4001", title: "TUBOS QUADRADOS", category: "squareTube", inchMeasures: ["1/2"], mmMeasures: [12.70, 1.30], weightKgM: 0.160 },
  { code: "TUB4002", title: "TUBOS QUADRADOS", category: "squareTube", inchMeasures: ["5/8"], mmMeasures: [15.87, 1.50], weightKgM: 0.233 },
  { code: "TUB4003", title: "TUBOS QUADRADOS", category: "squareTube", inchMeasures: ["3/4"], mmMeasures: [19.05, 1.50], weightKgM: 0.285 },
  { code: "TUB4008", title: "TUBOS QUADRADOS", category: "squareTube", inchMeasures: ["1"], mmMeasures: [25.40, 1.50], weightKgM: 0.386 },
  { code: "TUB4011", title: "TUBOS QUADRADOS", category: "squareTube", inchMeasures: ["1.1/4"], mmMeasures: [31.75, 1.20], weightKgM: 0.397 },
  { code: "TUB4014", title: "TUBOS QUADRADOS", category: "squareTube", inchMeasures: ["1.1/4"], mmMeasures: [38.10, 1.50], weightKgM: 0.594 },
  { code: "TUB4020", title: "TUBOS QUADRADOS", category: "squareTube", inchMeasures: ["2"], mmMeasures: [50.80, 1.40], weightKgM: 0.749 },
  { code: "TUB4034", title: "TUBOS QUADRADOS", category: "squareTube", inchMeasures: [], mmMeasures: [80.00, 1.80], weightKgM: 1.525 },
  { code: "TUB4054", title: "TUBOS QUADRADOS", category: "squareTube", inchMeasures: ["4"], mmMeasures: [101.60, 2.50], weightKgM: 2.685 },
  { code: "TUB4061", title: "TUBOS QUADRADOS", category: "squareTube", inchMeasures: ["1"], mmMeasures: [25.40, 1.00], weightKgM: 0.264 },
];
