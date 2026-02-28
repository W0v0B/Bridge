import { Input, Button, List, Form } from "antd";
import { useState } from "react";

interface Command {
  id: string;
  name: string;
  command: string;
}

export function CommandEditor() {
  const [commands, setCommands] = useState<Command[]>([]);

  return (
    <div>
      <Form layout="inline" style={{ marginBottom: 16 }}>
        <Form.Item><Input placeholder="Name" /></Form.Item>
        <Form.Item><Input placeholder="Command" /></Form.Item>
        <Form.Item><Button type="primary">Add</Button></Form.Item>
      </Form>
      <List
        dataSource={commands}
        renderItem={(item) => (
          <List.Item actions={[<Button size="small">Edit</Button>, <Button size="small" danger>Delete</Button>]}>
            <List.Item.Meta title={item.name} description={item.command} />
          </List.Item>
        )}
      />
    </div>
  );
}
