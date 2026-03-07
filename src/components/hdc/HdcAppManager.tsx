import { useEffect, useState, useCallback, useMemo } from "react";
import {
  Table,
  Button,
  Input,
  Popconfirm,
  message,
  Typography,
  Space,
  Tooltip,
  Tag,
  Radio,
} from "antd";
import {
  ReloadOutlined,
  DeleteOutlined,
  UploadOutlined,
  SearchOutlined,
  PoweroffOutlined,
  ClearOutlined,
} from "@ant-design/icons";
import { open } from "@tauri-apps/plugin-dialog";
import { useDeviceStore } from "../../store/deviceStore";
import { listBundles, installHap, uninstallBundle, forceStopBundle, clearBundleData } from "../../utils/hdc";
import type { BundleInfo } from "../../types/hdc";

type FilterMode = "all" | "user" | "system" | "vendor" | "product";

const TYPE_TAG: Record<string, { color: string }> = {
  user:    { color: "blue" },
  product: { color: "green" },
  vendor:  { color: "purple" },
  system:  { color: "orange" },
};

export function HdcAppManager() {
  const selectedDeviceId = useDeviceStore((s) => s.selectedDeviceId);
  const allDevices = useDeviceStore((s) => s.devices);
  const deviceObj = allDevices.find((d) => d.id === selectedDeviceId) ?? null;
  const connectKey = deviceObj?.serial ?? null;

  const [bundles, setBundles] = useState<BundleInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<FilterMode>("all");
  const [uninstallingPkg, setUninstallingPkg] = useState<string | null>(null);
  const [stoppingPkg, setStoppingPkg] = useState<string | null>(null);
  const [clearingPkg, setClearingPkg] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const loadBundles = useCallback(async () => {
    if (!connectKey) return;
    setLoading(true);
    try {
      const list = await listBundles(connectKey);
      setBundles(list);
    } catch (e) {
      message.error(String(e));
    } finally {
      setLoading(false);
    }
  }, [connectKey]);

  useEffect(() => {
    loadBundles();
  }, [loadBundles]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filter, searchQuery]);

  const handleInstall = async () => {
    if (!connectKey) return;
    const selected = await open({
      filters: [{ name: "HAP Package", extensions: ["hap"] }],
    });
    if (!selected) return;
    const hapPath = Array.isArray(selected) ? selected[0] : selected;
    try {
      await installHap(connectKey, hapPath);
      message.success("HAP installed successfully");
      loadBundles();
    } catch (e) {
      message.error(String(e));
    }
  };

  const handleForceStop = async (bundleName: string) => {
    if (!connectKey) return;
    setStoppingPkg(bundleName);
    try {
      await forceStopBundle(connectKey, bundleName);
      message.success(`Force stopped ${bundleName}`);
    } catch (e) {
      message.error(String(e));
    } finally {
      setStoppingPkg(null);
    }
  };

  const handleClearData = async (bundleName: string) => {
    if (!connectKey) return;
    setClearingPkg(bundleName);
    try {
      await clearBundleData(connectKey, bundleName);
      message.success(`Cleared data for ${bundleName}`);
    } catch (e) {
      message.error(String(e));
    } finally {
      setClearingPkg(null);
    }
  };

  const handleUninstall = async (bundleName: string) => {
    if (!connectKey) return;
    setUninstallingPkg(bundleName);
    try {
      await uninstallBundle(connectKey, bundleName);
      message.success(`Uninstalled ${bundleName}`);
      loadBundles();
    } catch (e) {
      message.error(String(e));
    } finally {
      setUninstallingPkg(null);
    }
  };

  const filtered = useMemo(
    () =>
      bundles.filter((b) => {
        if (filter !== "all" && b.app_type !== filter) return false;
        if (searchQuery && !b.bundle_name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
        return true;
      }),
    [bundles, filter, searchQuery]
  );

  if (!connectKey) {
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Typography.Text type="secondary" style={{ fontSize: 16 }}>
          Select an OHOS device from the sidebar to manage apps
        </Typography.Text>
      </div>
    );
  }

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        padding: "0 12px 12px",
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <Space>
          <Button icon={<UploadOutlined />} onClick={handleInstall}>
            Install HAP
          </Button>
          <Input
            prefix={<SearchOutlined />}
            placeholder="Search bundles…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            allowClear
            style={{ width: 220 }}
          />
          <Radio.Group
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            size="small"
            optionType="button"
            buttonStyle="solid"
            options={[
              { label: "All", value: "all" },
              { label: "User", value: "user" },
              { label: "Product", value: "product" },
              { label: "Vendor", value: "vendor" },
              { label: "System", value: "system" },
            ]}
          />
          <Tooltip title="Refresh">
            <Button icon={<ReloadOutlined />} onClick={loadBundles} loading={loading} />
          </Tooltip>
        </Space>
      </div>

      {/* Bundle table */}
      <div style={{ flex: 1, overflow: "auto" }}>
        <Table
          dataSource={filtered}
          rowKey="bundle_name"
          size="small"
          loading={loading}
          pagination={{
            current: currentPage,
            pageSize,
            onChange: (page, size) => {
              setCurrentPage(page);
              setPageSize(size);
            },
            showSizeChanger: true,
            pageSizeOptions: [20, 50, 100, 200],
            showTotal: (total) => `${total} bundle${total !== 1 ? "s" : ""}`,
          }}
          columns={[
            {
              title: "Bundle Name",
              dataIndex: "bundle_name",
              key: "bundle_name",
              render: (name: string) => (
                <Typography.Text style={{ fontFamily: "monospace", fontSize: 12 }}>
                  {name}
                </Typography.Text>
              ),
            },
            {
              title: "Type",
              dataIndex: "app_type",
              key: "app_type",
              width: 80,
              render: (t: string) => {
                const { color } = TYPE_TAG[t] ?? { color: "default" };
                return <Tag color={color}>{t}</Tag>;
              },
            },
            {
              title: "Install Path",
              dataIndex: "code_path",
              key: "code_path",
              render: (path: string) =>
                path ? (
                  <Tooltip title={path}>
                    <Typography.Text
                      type="secondary"
                      style={{ fontSize: 11, maxWidth: 300, display: "block" }}
                      ellipsis
                    >
                      {path}
                    </Typography.Text>
                  </Tooltip>
                ) : (
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>—</Typography.Text>
                ),
            },
            {
              title: "Actions",
              key: "action",
              width: 180,
              render: (_: unknown, record: BundleInfo) => {
                const isSystem = record.app_type !== "user";
                return (
                  <Space size={4}>
                    <Tooltip title="Force Stop">
                      <Button
                        size="small"
                        icon={<PoweroffOutlined />}
                        loading={stoppingPkg === record.bundle_name}
                        onClick={() => handleForceStop(record.bundle_name)}
                      />
                    </Tooltip>
                    <Popconfirm
                      title={`Clear all data for ${record.bundle_name}?`}
                      description="This will wipe all app data and cannot be undone."
                      onConfirm={() => handleClearData(record.bundle_name)}
                      okText="Clear"
                      okButtonProps={{ danger: true }}
                    >
                      <Tooltip title="Clear Data">
                        <Button
                          size="small"
                          icon={<ClearOutlined />}
                          loading={clearingPkg === record.bundle_name}
                        />
                      </Tooltip>
                    </Popconfirm>
                    <Tooltip title={isSystem ? "Cannot uninstall system bundles" : undefined}>
                      {isSystem ? (
                        <Button size="small" danger icon={<DeleteOutlined />} disabled>
                          Uninstall
                        </Button>
                      ) : (
                        <Popconfirm
                          title={`Uninstall ${record.bundle_name}?`}
                          onConfirm={() => handleUninstall(record.bundle_name)}
                          okText="Uninstall"
                          okButtonProps={{ danger: true }}
                        >
                          <Button
                            size="small"
                            danger
                            icon={<DeleteOutlined />}
                            loading={uninstallingPkg === record.bundle_name}
                          >
                            Uninstall
                          </Button>
                        </Popconfirm>
                      )}
                    </Tooltip>
                  </Space>
                );
              },
            },
          ]}
        />
      </div>
    </div>
  );
}
