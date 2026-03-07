import { useEffect, useState, useCallback, useMemo } from "react";
import {
  Table,
  Button,
  Space,
  Popconfirm,
  message,
  Typography,
  Tag,
  Tooltip,
  Input,
  Radio,
} from "antd";
import {
  UploadOutlined,
  DeleteOutlined,
  ReloadOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { open } from "@tauri-apps/plugin-dialog";
import { useDeviceStore } from "../../store/deviceStore";
import { listPackages, uninstallPackage, installApk } from "../../utils/adb";
import type { PackageInfo } from "../../types/adb";

type FilterMode = "all" | "user" | "system";

export function AppManager() {
  const selectedDeviceId = useDeviceStore((s) => s.selectedDeviceId);
  const allDevices = useDeviceStore((s) => s.devices);
  const deviceObj = allDevices.find((d) => d.id === selectedDeviceId) ?? null;
  const selectedDevice = deviceObj?.serial ?? null;
  const isRoot = deviceObj?.isRoot ?? false;

  const [packages, setPackages] = useState<PackageInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [filter, setFilter] = useState<FilterMode>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [uninstallingPkg, setUninstallingPkg] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const loadPackages = useCallback(async () => {
    if (!selectedDevice) return;
    setLoading(true);
    try {
      const pkgs = await listPackages(selectedDevice);
      setPackages(pkgs);
    } catch (e) {
      message.error(String(e));
    } finally {
      setLoading(false);
    }
  }, [selectedDevice]);

  useEffect(() => {
    loadPackages();
  }, [loadPackages]);

  // Reset to page 1 when filter or search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [filter, searchQuery]);

  const handleInstall = async () => {
    if (!selectedDevice) return;
    const selected = await open({
      filters: [{ name: "APK", extensions: ["apk"] }],
    });
    if (!selected) return;
    const path = Array.isArray(selected) ? selected[0] : selected;
    if (!path) return;
    setInstalling(true);
    const hide = message.loading("Installing APK…", 0);
    try {
      await installApk(selectedDevice, path);
      hide();
      message.success("APK installed successfully");
      loadPackages();
    } catch (e) {
      hide();
      message.error(String(e));
    } finally {
      setInstalling(false);
    }
  };

  const handleUninstall = async (pkg: PackageInfo) => {
    if (!selectedDevice) return;
    setUninstallingPkg(pkg.package_name);
    const action = pkg.is_system
      ? isRoot ? "Removing system app" : "Disabling app"
      : "Uninstalling";
    const hide = message.loading(`${action} ${pkg.package_name}…`, 0);
    try {
      await uninstallPackage(selectedDevice, pkg.package_name, pkg.is_system, isRoot);
      hide();
      message.success(
        pkg.is_system
          ? isRoot
            ? `Removed system app ${pkg.package_name}`
            : `Disabled ${pkg.package_name} for current user`
          : `Uninstalled ${pkg.package_name}`
      );
      loadPackages();
    } catch (e) {
      hide();
      message.error(String(e));
    } finally {
      setUninstallingPkg(null);
    }
  };

  const filteredPackages = useMemo(
    () =>
      packages.filter((pkg) => {
        if (filter === "user" && pkg.is_system) return false;
        if (filter === "system" && !pkg.is_system) return false;
        if (searchQuery && !pkg.package_name.toLowerCase().includes(searchQuery.toLowerCase()))
          return false;
        return true;
      }),
    [packages, filter, searchQuery]
  );

  const getConfirmTitle = (pkg: PackageInfo) => {
    if (!pkg.is_system) return `Uninstall ${pkg.package_name}?`;
    if (isRoot) return `Fully remove system app ${pkg.package_name}? (root — permanent)`;
    return `Disable ${pkg.package_name} for current user? (no root — soft disable, not permanent)`;
  };

  const columns = [
    {
      title: "Package Name",
      dataIndex: "package_name",
      key: "package_name",
      render: (name: string) => (
        <Typography.Text style={{ fontFamily: "monospace", fontSize: 12 }}>
          {name}
        </Typography.Text>
      ),
    },
    {
      title: "Type",
      dataIndex: "is_system",
      key: "is_system",
      width: 80,
      render: (isSystem: boolean) =>
        isSystem ? (
          <Tag color="orange">system</Tag>
        ) : (
          <Tag color="blue">user</Tag>
        ),
    },
    {
      title: "APK Path",
      dataIndex: "apk_path",
      key: "apk_path",
      render: (path: string) => (
        <Tooltip title={path}>
          <Typography.Text
            type="secondary"
            style={{ fontSize: 11, maxWidth: 300, display: "block" }}
            ellipsis
          >
            {path}
          </Typography.Text>
        </Tooltip>
      ),
    },
    {
      title: "Action",
      key: "action",
      width: 110,
      render: (_: unknown, record: PackageInfo) => (
        <Popconfirm
          title={getConfirmTitle(record)}
          onConfirm={() => handleUninstall(record)}
          okText="Confirm"
          okButtonProps={{ danger: true }}
        >
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            loading={uninstallingPkg === record.package_name}
          >
            {record.is_system && !isRoot ? "Disable" : "Uninstall"}
          </Button>
        </Popconfirm>
      ),
    },
  ];

  if (!selectedDevice) {
    return (
      <Typography.Text type="secondary">
        Select a device to manage apps
      </Typography.Text>
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
      {/* Fixed toolbar */}
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
          <Button icon={<UploadOutlined />} onClick={handleInstall} loading={installing}>
            Install APK
          </Button>
          <Input
            prefix={<SearchOutlined />}
            placeholder="Search packages…"
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
              { label: "System", value: "system" },
            ]}
          />
          <Tooltip title="Refresh">
            <Button icon={<ReloadOutlined />} onClick={loadPackages} loading={loading} />
          </Tooltip>
        </Space>
      </div>

      {/* Scrollable package list */}
      <div style={{ flex: 1, overflow: "auto" }}>
        <Table
          dataSource={filteredPackages}
          columns={columns}
          rowKey="package_name"
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
            showTotal: (total) => `${total} packages`,
          }}
        />
      </div>
    </div>
  );
}
