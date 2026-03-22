import { useEffect, useState, useCallback, useMemo } from "react";
import {
  App,
  Table,
  Button,
  Space,
  Popconfirm,
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
  PoweroffOutlined,
  ClearOutlined,
} from "@ant-design/icons";
import { open } from "@tauri-apps/plugin-dialog";
import { useDeviceStore } from "../../store/deviceStore";
import { useConfigStore } from "../../store/configStore";
import { THEMES } from "../../theme";
import { listPackages, uninstallPackage, installApk, forceStopPackage, clearPackageData, reEnablePackage } from "../../utils/adb";
import type { PackageInfo } from "../../types/adb";

type FilterMode = "all" | "user" | "system" | "product" | "vendor" | "hidden";

export function AppManager() {
  const { message } = App.useApp();
  const isDark = THEMES[useConfigStore((s) => s.config.theme)].isDark;
  const selectedDeviceId = useDeviceStore((s) => s.selectedDeviceId);
  const allDevices = useDeviceStore((s) => s.devices);
  const deviceObj = allDevices.find((d) => d.id === selectedDeviceId && d.type === "adb") ?? null;
  const selectedDevice = deviceObj?.serial ?? null;
  const isRoot = deviceObj?.isRoot ?? false;

  const [packages, setPackages] = useState<PackageInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [filter, setFilter] = useState<FilterMode>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [uninstallingPkg, setUninstallingPkg] = useState<string | null>(null);
  const [disablingPkg, setDisablingPkg] = useState<string | null>(null);
  const [stoppingPkg, setStoppingPkg] = useState<string | null>(null);
  const [clearingPkg, setClearingPkg] = useState<string | null>(null);
  const [reEnablingPkg, setReEnablingPkg] = useState<string | null>(null);
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

  const handleDisable = async (pkg: PackageInfo) => {
    if (!selectedDevice) return;
    setDisablingPkg(pkg.package_name);
    const hide = message.loading(`Disabling ${pkg.package_name}…`, 0);
    try {
      // Always soft-disable: pm uninstall -k --user 0
      await uninstallPackage(selectedDevice, pkg.package_name, true, false);
      hide();
      message.success(`Disabled ${pkg.package_name} for current user`);
      loadPackages();
    } catch (e) {
      hide();
      message.error(String(e));
    } finally {
      setDisablingPkg(null);
    }
  };

  const handleUninstall = async (pkg: PackageInfo) => {
    if (!selectedDevice) return;
    setUninstallingPkg(pkg.package_name);
    // User app: adb uninstall; system+root: pm uninstall (root)
    const isSystem = pkg.is_system;
    const hide = message.loading(`Uninstalling ${pkg.package_name}…`, 0);
    try {
      await uninstallPackage(selectedDevice, pkg.package_name, isSystem, isRoot);
      hide();
      message.success(
        isSystem
          ? `Removed system app ${pkg.package_name}`
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

  const handleForceStop = async (pkg: PackageInfo) => {
    if (!selectedDevice) return;
    setStoppingPkg(pkg.package_name);
    try {
      await forceStopPackage(selectedDevice, pkg.package_name);
      message.success(`Force stopped ${pkg.package_name}`);
    } catch (e) {
      message.error(String(e));
    } finally {
      setStoppingPkg(null);
    }
  };

  const handleClearData = async (pkg: PackageInfo) => {
    if (!selectedDevice) return;
    setClearingPkg(pkg.package_name);
    try {
      await clearPackageData(selectedDevice, pkg.package_name);
      message.success(`Cleared data for ${pkg.package_name}`);
    } catch (e) {
      message.error(String(e));
    } finally {
      setClearingPkg(null);
    }
  };

  const handleReEnable = async (pkg: PackageInfo) => {
    if (!selectedDevice) return;
    setReEnablingPkg(pkg.package_name);
    try {
      await reEnablePackage(selectedDevice, pkg.package_name);
      message.success(`Re-enabled ${pkg.package_name}`);
      loadPackages();
    } catch (e) {
      message.error(String(e));
    } finally {
      setReEnablingPkg(null);
    }
  };

  const filteredPackages = useMemo(
    () =>
      packages.filter((pkg) => {
        if (filter === "hidden") {
          if (!pkg.is_hidden) return false;
        } else if (filter !== "all") {
          if (pkg.app_type !== filter) return false;
        }
        if (searchQuery && !pkg.package_name.toLowerCase().includes(searchQuery.toLowerCase()))
          return false;
        return true;
      }),
    [packages, filter, searchQuery]
  );

  const getUninstallTitle = (pkg: PackageInfo) => {
    if (!pkg.is_system) return `Uninstall ${pkg.package_name}?`;
    return `Remove system app ${pkg.package_name}? (root — database-level, reverts on factory reset)`;
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
      key: "type",
      width: 130,
      render: (_: unknown, record: PackageInfo) => {
        // Preset names produce fixed dark backgrounds in dark mode that clash
        // with lighter containers (notably Nord). In dark themes, use card-bg
        // with an explicit text/border colour instead.
        const presetColors: Record<string, string> = {
          user: "blue", product: "green", vendor: "purple", system: "orange",
        };
        const hexColors: Record<string, string> = {
          user: "#4096ff", product: "#52c41a", vendor: "#9254de", system: "#fa8c16",
        };
        const typeTag = isDark ? (() => {
          const hex = hexColors[record.app_type] ?? "#8c8c8c";
          return (
            <Tag style={{ color: hex, backgroundColor: "var(--card-bg)", border: `1px solid ${hex}80` }}>
              {record.app_type}
            </Tag>
          );
        })() : <Tag color={presetColors[record.app_type] ?? "default"}>{record.app_type}</Tag>;
        return (
          <Space size={4}>
            {typeTag}
            {record.is_hidden && (
              isDark
                ? <Tag style={{ color: "#ff4d4f", backgroundColor: "var(--card-bg)", border: "1px solid #ff4d4f80" }}>hidden</Tag>
                : <Tag color="red">hidden</Tag>
            )}
            {record.is_disabled && <Tag color="default">disabled</Tag>}
          </Space>
        );
      },
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
      title: "Actions",
      key: "action",
      width: 220,
      render: (_: unknown, record: PackageInfo) => {
        if (record.is_hidden) {
          return (
            <Popconfirm
              title={`Re-enable ${record.package_name}?`}
              description="This will restore the app for the current user."
              onConfirm={() => handleReEnable(record)}
              okText="Re-enable"
            >
              <Button size="small" loading={reEnablingPkg === record.package_name}>
                Re-enable
              </Button>
            </Popconfirm>
          );
        }
        const canUninstall = !record.is_system || isRoot;
        return (
          <Space size={4}>
            <Tooltip title="Force Stop">
              <Button
                size="small"
                icon={<PoweroffOutlined />}
                loading={stoppingPkg === record.package_name}
                onClick={() => handleForceStop(record)}
              />
            </Tooltip>
            <Popconfirm
              title={`Clear all data for ${record.package_name}?`}
              description="This will wipe all app data and cannot be undone."
              onConfirm={() => handleClearData(record)}
              okText="Clear"
              okButtonProps={{ danger: true }}
            >
              <Tooltip title="Clear Data">
                <Button
                  size="small"
                  icon={<ClearOutlined />}
                  loading={clearingPkg === record.package_name}
                />
              </Tooltip>
            </Popconfirm>
            <Tooltip title={record.is_system ? undefined : "Only available for system apps"}>
              {record.is_system ? (
                <Popconfirm
                  title={`Disable ${record.package_name} for current user?`}
                  description="The app will be hidden but can be re-enabled later."
                  onConfirm={() => handleDisable(record)}
                  okText="Disable"
                >
                  <Button size="small" loading={disablingPkg === record.package_name}>
                    Disable
                  </Button>
                </Popconfirm>
              ) : (
                <Button size="small" disabled>
                  Disable
                </Button>
              )}
            </Tooltip>
            <Tooltip title={canUninstall ? undefined : "Requires root to uninstall system apps"}>
              {canUninstall ? (
                <Popconfirm
                  title={getUninstallTitle(record)}
                  onConfirm={() => handleUninstall(record)}
                  okText="Uninstall"
                  okButtonProps={{ danger: true }}
                >
                  <Button
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    loading={uninstallingPkg === record.package_name}
                  >
                    Uninstall
                  </Button>
                </Popconfirm>
              ) : (
                <Button size="small" danger icon={<DeleteOutlined />} disabled>
                  Uninstall
                </Button>
              )}
            </Tooltip>
          </Space>
        );
      },
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
              { label: "Product", value: "product" },
              { label: "Vendor", value: "vendor" },
              { label: "System", value: "system" },
              { label: "Hidden", value: "hidden" },
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
