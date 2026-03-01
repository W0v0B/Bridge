export interface ConnectedDevice {
  id: string;
  type: "adb" | "serial";
  name: string;
  serial: string;
  state: string;
  model?: string;
  product?: string;
}
