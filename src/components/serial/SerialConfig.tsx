import { Form, Select, InputNumber, Button } from "antd";

export function SerialConfig() {
  return (
    <Form layout="inline">
      <Form.Item label="Port">
        <Select style={{ width: 120 }} placeholder="Select port" />
      </Form.Item>
      <Form.Item label="Baud Rate">
        <Select defaultValue={115200} style={{ width: 100 }} options={[
          { value: 9600, label: "9600" },
          { value: 115200, label: "115200" },
          { value: 921600, label: "921600" },
        ]} />
      </Form.Item>
      <Form.Item>
        <Button type="primary">Connect</Button>
      </Form.Item>
    </Form>
  );
}
