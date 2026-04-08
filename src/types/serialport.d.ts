declare module 'serialport' {
  export interface SerialPortInfo {
    path: string;
    manufacturer?: string;
    serialNumber?: string;
    vendorId?: string;
    productId?: string;
  }

  export const SerialPort: {
    list(): Promise<SerialPortInfo[]>;
  };
}
