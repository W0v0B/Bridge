export interface ConnectedDevice {
  id: string;
  type: "adb" | "serial" | "ohos";
  name: string;
  serial: string;
  state: string;
  model?: string;
  product?: string;
  isRoot?: boolean;
  isRemounted?: boolean;
  remountInfo?: string;
}
