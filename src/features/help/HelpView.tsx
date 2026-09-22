import { Collapse, Space, Tag, Typography } from "antd";
import SectionCard from "../../components/SectionCard";
import { MAX_ADDRESS_ROWS } from "../home/homeForm";

const FLOW_STEPS: Array<{ step: string; text: string }> = [
  {
    step: "1. 选择网卡",
    text: "在「网卡配置」页顶部的「网卡列表」中选择要配置的网卡，确认名称、状态（已连接 / 未连接 / 已禁用）与当前 IP。程序会记住上次选择的网卡。",
  },
  {
    step: "2. 读取当前配置",
    text: "点击「IP 配置」卡片右上角的「读取当前配置」，把该网卡的地址、掩码、网关、DNS 与 DHCP 状态填入表单作为起点；顶部工具栏的「刷新网卡列表」只刷新状态，不改表单。",
  },
  {
    step: "3. 填写目标配置",
    text: `在「IP 配置」中选择「自动获取（DHCP）」或「手动设置（静态）」：静态模式下填写地址与掩码（双击「子网掩码」标签可一键填入 A / B / C 类默认掩码），需要多个地址时点「添加地址」（最多 ${MAX_ADDRESS_ROWS} 个），还可以设置默认网关、接口跃点数与 DNS。`,
  },
  {
    step: "4. 应用配置",
    text: "点击「应用配置」，程序先生成变更清单（改动项、警告、错误）并弹出确认框；确认后才写入系统。可在「偏好设置」中关闭确认框，但不建议。",
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
    text: "写入前捕获的备份会随结果保存在「备份与恢复」卡片中，可以随时恢复；也可以把当前配置保存为方案（「方案管理」→ 从当前网卡读取），之后一键套用。",
  },
];

const FEATURES: Array<{ key: string; label: string; body: string }> = [
  {
    key: "ip",
    label: "静态 IP / 自动获取（DHCP）切换",
    body: "在「IP 配置」的「获取方式」中可以一键在「自动获取（DHCP）」与「手动设置（静态）」之间切换。切到静态时会写入你填写的地址、掩码与网关；切到自动获取时会先删除残留的静态地址再启用 DHCP，避免出现静态 + DHCP 同时存在的半配置状态。",
  },
  {
    key: "multi-ip",
    label: "单网卡多 IP",
    body: `「IP 配置」中可以为同一块网卡添加多行 IPv4 地址与对应掩码（最多 ${MAX_ADDRESS_ROWS} 个），用于同时接入多个网段（例如设备调试网段与管理网段共存）。`,
  },
  {
    key: "gateway",
    label: "网关按子网推导",
    body: "双击「默认网关」标签会根据第一个地址与掩码推导该子网的网关：取子网的第一个可用地址（通常就是 .1；若该地址正是本机地址则改用 .2）。掩码前缀大于等于 /31 时不推导网关。",
  },
  {
    key: "mask",
    label: "掩码 A / B / C 类快捷",
    body: "双击「子网掩码」标签可一键填入传统 A / B / C 类默认掩码（255.0.0.0、255.255.0.0、255.255.255.0）；也可以直接填写前缀长度（如 /22）或 255.255.252.0，由程序换算。",
  },
  {
    key: "dns",
    label: "DNS 手动 / 自动",
    body: "静态 DNS 支持填写多个服务器（按顺序生效）；选择自动时跟随 DHCP 下发的 DNS。写入后同样会读回校验。",
  },
  {
    key: "metric",
    label: "接口跃点数",
    body: "「IP 配置」的「接口跃点数」影响多网卡环境下 Windows 的路由优先级：数值越小优先级越高，留空表示由系统自动决定。",
  },
  {
    key: "enable",
    label: "启用 / 禁用网卡",
    body: "「IP 配置」卡片右上角的「禁用网卡 / 启用网卡」等同设备管理器、网络连接中的操作：禁用会立即断开该网卡上的连接，重新启用会让驱动重新加载配置。被禁用的网卡仍会出现在「网卡列表」中（标记为已禁用），写入地址前请先启用。",
  },
  {
    key: "mac",
    label: "MAC 地址修改",
    body: "修改 MAC 会写入注册表 NetworkAddress 覆盖值并重启网卡，使其立即生效；「清除覆盖」即恢复硬件地址。随机生成规则：12 位十六进制，首字节最低位固定为 0（单播地址），同时置本地管理位（第二位为 1），避免与真实厂商的 OUI 冲突；不能使用全 0、全 FF 或组播地址。入口在「网卡配置」页的「网卡 MAC 地址」卡片，当前 MAC、永久 MAC 与覆盖值可在同页的「选中网卡详情」中核对；修改 MAC 需要管理员权限。",
  },
  {
    key: "schemes",
    label: "方案管理与 CSV / Excel 导入",
    body: "方案可保存地址、掩码、网关、接口跃点数、DNS、DHCP 状态与备注，并可按匹配 MAC、主机名或网卡名自动套用；列表中会标记哪个方案匹配当前网卡。导入支持 CSV 与 Excel（.xlsx / .xls），表头中英文均可（详见常见问题）；导出为 CSV 的列与导入一致，可以往返使用。",
  },
  {
    key: "scan",
    label: "网络扫描（ARP / ICMP / 系统 ping）",
    body: "在「工具箱」中切到「网络扫描」：填写扫描目标（单个地址、逗号或空格分隔、192.168.1.0/24 网段、192.168.1.10-20 范围），可点「展开目标」预览目标数量，或用「使用当前网卡网段」按当前网卡的地址与掩码填入。ARP 模式基于系统 SendARP，只在本网段有效，但能发现不回 ICMP 的主机（开启防火墙的 Windows、打印机、摄像头等），并给出 MAC；ICMP 模式使用 IcmpSendEcho，可以跨网段，但被防火墙拦截时会显示无响应；系统 ping 模式调用 ping.exe 并解析其（含中文）输出。速度可选「快速」（按并发数同时发包，地址之间不额外等待）与「慢速」（每个地址的多轮探测之间插入约 350 毫秒延时，减轻对老旧或探测频率受限设备的冲击，耗时更长）。「高级参数」里可以调整并发数，以及开启多连发（对每个地址重复多轮探测并合并最快 / 最慢延时与丢包数，便于观察偶发丢包与最小时延）。结果表支持排序、只看在线与关键字过滤，本机行会高亮；页面右上角可导出 CSV 或复制结果。",
  },
  {
    key: "subnet",
    label: "掩码计算",
    body: "「工具箱」→「掩码计算」：输入地址与掩码 / 前缀，计算网络地址、广播地址、可用主机范围、反掩码、地址总数与掩码类别，并提示是否属于私有地址段；双击任意结果值即可复制，点「用该网段扫描」会把该网段直接带到网络扫描页。该功能只做计算，不会修改系统配置。",
  },
];

const REMOVED: Array<{ key: string; label: string; body: string }> = [
  {
    key: "identity",
    label: "计算机名 / 工作组修改",
    body: "已移除。这类修改必须重启系统才生效，和本程序「改完即可读回校验」的网络配置流程完全不一致，也与网卡配置这一主题弱相关。需要改名时请使用 Windows 的「设置 → 系统 → 系统信息」或 sysdm.cpl。",
  },
  {
    key: "gateway-metric",
    label: "网关跃点（网关度量值）",
    body: "已移除。网关跃点写入后无法可靠读回验证，容易与「接口跃点数」混淆，也无法给出确定的成功/失败结论，因此不再提供入口。需要控制路由优先级时，请使用「接口跃点数」（数值越小优先级越高）。",
  },
  {
    key: "retries",
    label: "探测重试次数",
    body: "已移除。该参数从未真正生效——底层探测不读取它，界面上的数值不会改变扫描行为，留着只会误导。需要提高准确率时请使用「高级参数」里的多连发，或改用 ICMP / 系统 ping 模式。",
  },
  {
    key: "portable",
    label: "便携模式开关",
    body: "已移除。改为自动识别：只要程序目录存在 portable.txt，配置就存到程序目录，否则使用 %APPDATA%\\iptools，不需要在界面里切换，也避免切换后要重启才能生效。当前生效的目录会在「偏好设置」的「配置位置」中显示。",
  },
  {
    key: "advanced-page",
    label: "「高级选项」页",
    body: "已移除。该页原有的能力（多 IP 地址行、按子网推导网关、A / B / C 类默认掩码、保存为方案、恢复备份）现在都在「网卡配置」页，单独占一页只会让入口重复，因此整页删除。",
  },
  {
    key: "identity-page",
    label: "「主机设置」页",
    body: "已移除。MAC 地址修改已并入「网卡配置」页的「网卡 MAC 地址」卡片，只读的诊断信息（主机名、工作组、MAC 等）移入同页的「技术详情」折叠卡，因此不再单独占一个页面。",
  },
];

const PLATFORM: Array<{ key: string; label: string; body: string }> = [
  {
    key: "wifi-dhcp",
    label: "Wi-Fi 网卡上静态地址与 DHCP 共存",
    body: "无线网卡切换为「手动设置（静态）」时，Windows 可能同时保留 DHCP 下发的配置（例如 DHCP 的默认网关与 DNS），因此在 Wi-Fi 上写入静态地址后，读回结果里可能还能看到 DHCP 的信息；程序以实际生效的地址为准做校验，切换回「自动获取」时会清理残留的静态地址。",
  },
  {
    key: "disabled-visible",
    label: "被禁用的网卡仍然可见",
    body: "禁用的网卡仍会出现在「网卡列表」中，状态显示为已禁用（可以选择、可以查看详情），但系统会拒绝修改它的 IP 配置——需要先在「IP 配置」中「启用网卡」。部分虚拟网卡与已移除硬件的网卡也会留在列表里。",
  },
  {
    key: "random-mac",
    label: "随机 MAC 的生成规则",
    body: "随机生成的地址为 12 位十六进制：首字节最低位固定为 0（单播），本地管理位置 1（第二位为 1），从而避免与真实厂商的 OUI 冲突；不会生成全 0、全 FF 或组播地址。某些驱动（例如 Intel 无线网卡）只在设备栈重建后才会重新读取 NetworkAddress，因此需要通过重启网卡来生效。",
  },
  {
    key: "config-path",
    label: "配置目录",
    body: "默认 %APPDATA%\\iptools（settings.json 存界面设置，schemes.json 存方案）。若程序目录存在 portable.txt，则自动改用程序目录存放配置（绿色版，可随程序一起拷贝）。「偏好设置」→「配置位置」可以复制这两个文件的完整路径，或点「打开配置目录」直接打开。",
  },
];

const FAQ: Array<{ key: string; label: string; body: string }> = [
  {
    key: "elevation",
    label: "为什么需要管理员权限？",
    body: "修改 IP / DNS、启用禁用网卡、写入 MAC 覆盖值，本质上都是修改 Windows 的网络配置与注册表，普通用户令牌会被系统拒绝。程序在写入前会检查权限，未提权时返回 NOT_ELEVATED 并给出「以管理员身份重启」入口；只读查看网卡信息不需要提权。",
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
    body: "第一行必须是表头，至少要有「名称(name)」与「地址(IP地址/ip)」两列。地址列可写多个地址（用逗号、分号或空格分隔），掩码列可写 255.255.255.0 或前缀 24，缺省按 /24 处理。中英文表头都支持，例如：name / 名称 / 方案名；地址 / IP地址 / ip；掩码 / 子网掩码 / mask / prefix；网关 / 默认网关；DNS / DNS服务器；DNS模式；跃点 / 接口跃点数；备注 / 说明；以及第二、第三个地址列 地址2 / 掩码2、地址3 / 掩码3。无法识别的列会被忽略，出错的行会在导入报告中列出并跳过。",
  },
  {
    key: "paths",
    label: "配置存放在哪里？",
    body: "默认位于 %APPDATA%\\iptools，含 settings.json（界面设置）与 schemes.json（方案）。如果程序目录存在 portable.txt，则自动改用程序所在目录存放配置（绿色版），可随程序一起拷贝；程序装在 Program Files 等受保护目录时该目录可能不可写。设置页可以复制这些路径，或点击「打开配置目录」直接打开。",
  },
  {
    key: "arp-icmp",
    label: "ARP 与 ICMP 的扫描结果为什么不一样？",
    body: "ARP 只能在同一个广播域内解析，只要能收到 ARP 应答就算在线，因此可以发现在线但不回 ICMP 的主机（这类主机常出现在结果里只有 MAC 没有延时的情况）；ICMP 需要目标主机回显应答，可跨网段但会被防火墙或路由器策略拦截。在「高级参数」中开启多连发时结果会合并多轮探测，偶发丢包会让最小延时仍显示在线但接收数少于发送数。",
  },
  {
    key: "scan-risk",
    label: "扫描会对网络造成影响吗？",
    body: "会。网络扫描会对目标范围内的每个地址发送探测包，一个 /24 网段就是 254 个地址，速度选「慢速」虽然降低速率但耗时更长。请只对自己拥有或已获授权的网络使用，不要对互联网或他人网络扫描，以免触发安全告警或影响网络设备。",
  },
];

export default function HelpView() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">使用帮助</h1>
          <p className="page-head__desc">
            使用流程、功能说明与常见问题；左侧导航可在网卡配置 / 方案管理 / 工具箱 / 偏好设置 / 使用帮助之间切换。
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
            读取与查看不需要管理员权限，写入才需要；任何时候都可以重新读取当前配置再修改。
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

      <SectionCard title="已移除的功能" hint="这些入口曾经存在，现已删除；这里说明原因">
        <Collapse
          ghost
          items={REMOVED.map((item) => ({
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
          <Tag>portable.txt：自动改用程序目录</Tag>
          <Tag>读回校验最长约 6 秒</Tag>
        </div>
      </SectionCard>

      <SectionCard title="平台行为要点" hint="Windows 上的实际表现，与界面提示可能不同">
        <Collapse
          ghost
          items={PLATFORM.map((item) => ({
            key: item.key,
            label: item.label,
            children: (
              <Typography.Paragraph style={{ marginBottom: 0 }}>{item.body}</Typography.Paragraph>
            ),
          }))}
        />
      </SectionCard>

      <SectionCard title="安全提示" hint="写入系统网络配置前的必读内容">
        <div className="danger-note">
          <span>
            本程序会修改系统的网络配置（IP、掩码、网关、DNS、跃点数、网卡启停、MAC 地址），
            写入过程中可能导致当前连接短时中断，甚至让远程桌面 / VPN 会话断开。
            请在写入前确认「目标网卡」与填写内容无误，尽量在本机操作；
            拿不准时先保存为方案或保留备份，必要时再恢复。
          </span>
        </div>
      </SectionCard>
    </>
  );
}
