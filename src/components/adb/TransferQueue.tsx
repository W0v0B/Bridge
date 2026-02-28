import { List, Progress } from "antd";

interface Transfer {
  id: string;
  name: string;
  progress: number;
  status: "pending" | "transferring" | "completed" | "error";
}

export function TransferQueue() {
  const transfers: Transfer[] = [];

  return (
    <List
      dataSource={transfers}
      renderItem={(item) => (
        <List.Item>
          <List.Item.Meta title={item.name} description={item.status} />
          <Progress percent={item.progress} size="small" style={{ width: 100 }} />
        </List.Item>
      )}
      locale={{ emptyText: "No active transfers" }}
    />
  );
}
