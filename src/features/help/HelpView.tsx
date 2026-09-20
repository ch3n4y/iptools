import { Collapse, Space, Tag, Typography } from "antd";
import SectionCard from "../../components/SectionCard";

const FLOW_STEPS: Array<{ step: string; text: string }> = [
  {
    step: "1. 选择网卡",
    text: "在「主界面」顶部选择要配置的网卡，确认名称、状态（已连接 / 未连接 / 已禁用）与当前 IP。程序会记住上次选择的网卡。",
  },
  {
    step: "2. 读取当前配置",
    text: "程序自动读取该网卡的地址、掩码、网关、跃点数、DNS 与 DHCP 状态，填入表单作为起点；点击「刷新网卡」可随时重新读取。",
  },
  {
    step: "3. 填写目标配置",
    text: "填写地址与掩码（可用 A/B/C 类快捷掩码），或切换到自动获取；高级选项里可加多个 IP、设置接口跃点数与 DNS。",
  },
  {
    step: "4. 应用配置",
    text: "点击「应用配置」，程序先生成变更清单（改动项、警告、错误）并弹出确认框；确认后才写入系统。可在设置中关闭确认框，但不建议。",
  },
  {
    step: "5. 写入并读回校验",
    text: "写入由后台通过 netsh 等系统接口完成，随后每 400 毫秒读回一次网卡状态，最多等待约 6 秒，用于确认配置真正生效。",
  },
  {
    step: "6. 校验失败自动回滚",
    text: "若读回结果与预期不一致，程序会列出差异项，并自动恢复写入前捕获的配置；失败原因（命令输出、错误码）可在「技术详情」中展开查看。",
  },
  {
    step: "7. 需要时恢复备份",
    text: "写入前捕获的备份会随结果保存，可在界面上直接恢复；也可以把当前配置保存为方案，之后一键套用。",
  },
];

const FEATURES: Array<{ key: string; label: string; body: string }> = [
  {
    key: "ip",
    label: "静态 IP / 自动获取（DHCP）切换",
    body: "可以一键在「自动获取」与「手动填写」之间切换。切到手动时会写入你填写的地址、掩码与网关；切到自动获取时会先删除残留的静态地址再启用 DHCP，避免出现静态 + DHCP 同时存在的半配置状态。",
  },
  {
    key: "multi-ip",
    label: "单网卡多 IP",
    body: "「高级选项」里可以为同一块网卡添加多个 IPv4 地址与对应掩码，用于同时接入多个网段（例如设备调试网段与管理网段共存）。",
  },
  {
    key: "gateway",
    label: "网关按子网推导",
    body: "根据地址与掩码计算出该子网的第一个可用地址作为默认网关（通常就是 .1；若该地址正是本机地址则改用 .2）。掩码前缀大于等于 /31 时不推导网关。",
  },
  {
    key: "mask",
    label: "掩码 A / B / C 类快捷",
    body: "输入地址后可一键填入传统 A / B / C 类默认掩码（255.0.0.0、255.255.0.0、255.255.255.0），也可以直接填写前缀长度（如 /22）由程序换算。",
  },
  {
    key: "dns",
    label: "DNS 手动 / 自动",
    body: "静态 DNS 支持填写多个服务器（按顺序生效）；选择自动时跟随 DHCP 下发的 DNS。写入后同样会读回校验。",
  },
  {
    key: "metric",
    label: "接口跃点数",
    body: "可以设置接口跃点数与网关跃点，影响多网卡环境下 Windows 的路由优先级：数值越小优先级越高。",
  },
  {
    key: "enable",
    label: "启用 / 禁用网卡",
    body: "可以直接启用或禁用网卡（等同设备管理器 / 网络连接中的操作），禁用后再启用可以让某些驱动立即重新加载配置。",
  },
  {
    key: "mac",
    label: "MAC 地址修改",
    body: "在「主机与 MAC」页写入注册表 NetworkAddress 覆盖值并重启网卡，使其立即生效；「清除覆盖」即恢复硬件地址。随机生成规则：12 位十六进制，首字节最低位固定为 0（单播地址），同时置本地管理位（第二位为 1），避免与真实厂商的 OUI 冲突；不能使用全 0、全 FF 或组播地址。",
  },
  {
    key: "identity",
    label: "计算机名 / 工作组",
    body: "可修改主机名（DNS 主机名）与 NetBIOS 名、或把计算机加入指定工作组。名称限制 1-15 个字符，仅字母、数字与连字符，且不能全部是数字；修改需要重启系统才会生效，域成员改为工作组会退出域。",
  },
  {
    key: "schemes",
    label: "方案管理与 CSV / Excel 导入",
    body: "方案可保存地址、掩码、网关、跃点、DNS、DHCP 状态与备注，并可按匹配 MAC、主机名或网卡名自动套用。导入支持 CSV 与 Excel（.xlsx / .xls），表头中英文均可（详见常见问题）；导出为 CSV 的列与导入一致，可以往返使用。",
  },
  {
    key: "ping",
    label: "C 网群 Ping 器",
    body: "ARP 模式基于系统 SendARP，只在本网段有效，但能发现不回 ICMP 的主机（开启防火墙的 Windows、打印机、摄像头等），并给出 MAC；ICMP 模式使用 IcmpSendEcho，可以跨网段，但被防火墙拦截时会显示无响应；系统 ping 模式调用 ping.exe 并解析其（含中文）输出。慢速模式逐个地址延时探测，降低对交换机的冲击，适合无线或老旧设备；多连发模式对每个地址重复多轮探测并合并结果，便于观察偶发丢包与最小时延。",
  },
  {
    key: "subnet",
    label: "子网掩码计算器",
    body: "输入地址与掩码 / 前缀，计算网络地址、广播地址、可用主机范围、地址总数与掩码类别，并提示是否属于私有地址段。该功能只做计算，不会修改系统配置。",
  },
];

const FAQ: Array<{ key: string; label: string; body: string }> = [
  {
    key: "elevation",
    label: "为什么需要管理员权限？",
    body: "修改 IP / DNS、启用禁用网卡、写入 MAC 覆盖值、修改计算机名与工作组，本质上都是修改 Windows 的网络配置与注册表，普通用户令牌会被系统拒绝。程序在写入前会检查权限，未提权时返回 NOT_ELEVATED 并给出「以管理员身份重启」入口；只读查看网卡信息不需要提权。",
  },
  {
    key: "latency",
    label: "写入后多久生效？",
    body: "写入由系统接口完成，随即可见；程序随后会自动轮询读回验证，间隔 400 毫秒、最多约 6 秒。若到时限仍未读到预期状态，会在结果中列出差异项（mismatches），并自动尝试恢复写入前的配置。个别驱动（尤其是无线网卡与虚拟网卡）需要更长时间或重新连接才会刷新状态。",
  },
  {
    key: "apipa",
    label: "为什么显示 169.254.x.x？",
    body: "169.254.0.0/16 是 Windows 在 DHCP 未取到地址时自动分配的 APIPA 地址，表示这块网卡当前没有有效配置。常见原因：DHCP 服务器不可达、网线未插 / 无线未关联、交换机端口被禁用，或刚刚清空了静态地址正在等待 DHCP。",
  },
  {
    key: "import",
    label: "导入 Excel 的列名有什么要求？",
    body: "第一行必须是表头，至少要有「名称(name)」与「地址(IP地址/ip)」两列。地址列可写多个地址（用逗号、分号或空格分隔），掩码列可写 255.255.255.0 或前缀 24，缺省按 /24 处理。中英文表头都支持，例如：name / 名称 / 方案名；地址 / IP地址 / ip；掩码 / 子网掩码 / mask / prefix；网关 / 默认网关；DNS / DNS服务器；DNS模式；跃点 / 接口跃点数；网关跃点；备注 / 说明；以及第二、第三个地址列 地址2 / 掩码2、地址3 / 掩码3。无法识别的列会被忽略，出错的行会在导入报告中列出并跳过。",
  },
  {
    key: "paths",
    label: "配置存放在哪里？",
    body: "默认位于 %APPDATA%\\iptools，含 settings.json（界面设置）与 schemes.json（方案）。开启便携模式后会在程序目录创建 portable.txt，配置改存程序所在目录，可随程序一起拷贝；程序装在 Program Files 等受保护目录时可能因权限无法创建该文件。设置页可以复制这两个路径，或点击「打开配置目录」直接打开。",
  },
  {
    key: "arp-icmp",
    label: "ARP 与 ICMP 的扫描结果为什么不一样？",
    body: "ARP 只能在同一个广播域内解析，只要能收到 ARP 应答就算在线，因此可以发现在线但不回 ICMP 的主机（这类主机常出现在结果里只有 MAC 没有延时的情况）；ICMP 需要目标主机回显应答，可跨网段但会被防火墙或路由器策略拦截。启用「多连发」时结果会合并多轮探测，偶发丢包会让最小延时仍显示在线但接收数少于发送数。",
  },
  {
    key: "scan-risk",
    label: "扫描会对网络造成影响吗？",
    body: "会。群 Ping 会对目标范围内的每个地址发送探测包，一个 /24 网段就是 254 个地址，慢速模式虽然降低速率但耗时更长。请只对自己拥有或已获授权的网络使用，不要对互联网或他人网络扫描，以免触发安全告警或影响网络设备。",
  },
];

export default function HelpView() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">使用帮助</h1>
          <p className="page-head__desc">
            使用流程、功能说明与常见问题；左侧菜单可在各功能页之间切换。
          </p>
        </div>
      </div>

      <SectionCard title="使用流程" hint="一次完整的配置写入过程">
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <ol className="plan-list">
            {FLOW_STEPS.map((item) => (
              <li className="plan-row" key={item.step}>
                <span className="plan-row__label">{item.step}</span>
                <span className="plan-row__change">{item.text}</span>
              </li>
            ))}
          </ol>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            任何时候都可以点击「刷新网卡」重新读取状态；读取不需要管理员权限，写入才需要。
          </Typography.Text>
        </Space>
      </SectionCard>

      <SectionCard title="功能说明" hint="点击标题展开每项功能的实现细节">
        <Collapse
          ghost
          items={FEATURES.map((item) => ({
            key: item.key,
            label: item.label,
            children: (
              <Typography.Paragraph style={{ marginBottom: 0 }}>{item.body}</Typography.Paragraph>
            ),
          }))}
        />
      </SectionCard>

      <SectionCard title="常见问题" hint="提权、生效时间、169.254 地址、Excel 导入与配置位置">
        <Collapse
          ghost
          items={FAQ.map((item) => ({
            key: item.key,
            label: item.label,
            children: (
              <Typography.Paragraph style={{ marginBottom: 0, whiteSpace: "pre-wrap" }}>
                {item.body}
              </Typography.Paragraph>
            ),
          }))}
        />
        <div className="tag-row" style={{ marginTop: 12 }}>
          <Tag>配置目录：%APPDATA%\iptools</Tag>
          <Tag>便携模式：程序目录</Tag>
          <Tag>读回校验最长约 6 秒</Tag>
        </div>
      </SectionCard>

      <SectionCard title="安全提示" hint="写入系统网络配置前的必读内容">
        <div className="danger-note">
          <span>
            本程序会修改系统的网络配置（IP、掩码、网关、DNS、跃点数、网卡启停、MAC 地址、计算机名与工作组），
            写入过程中可能导致当前连接短时中断，甚至让远程桌面 / VPN 会话断开。
            请在写入前确认「目标网卡」与填写内容无误，尽量在本机操作；
            拿不准时先保存为方案或保留备份，必要时再恢复。
          </span>
        </div>
      </SectionCard>
    </>
  );
}
