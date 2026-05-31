// generated from planetar:Vessel@1.0.0 — do not edit
export interface planetar_Vessel {
  "mmsi": number;
  "name": string;
  "vessel_class"?: "cargo" | "ferry" | "tanker" | "fishing" | "pleasure" | "sailing" | "pilot" | "tug" | "high-speed" | "passenger" | "other";
  "flag"?: string | null;
  "length_m"?: number | null;
  "callsign"?: string | null;
  "lat": number;
  "lon": number;
  "sog"?: number;
  "cog"?: number;
  "heading"?: number;
  "destination"?: string | null;
  "last_seen_ns": string;
  "first_seen_ns"?: string;
  "in_bbox"?: boolean;
  "confidence": number;
  "acme:hull_temp_c"?: number | null;
}
