国能E招
http://www.chnenergybidding.com.cn/bidweb/001/001002/moreinfo.html

中国华电集团电子商务平台
https://www.chdtp.com/

https://www.chdtp.com/pages/wzglS/cgxx/caigou.jsp?cgtype=4





大唐电子商务平台
https://www.cdt-ec.com/home/index.html



国能E购·电力专区  
https://www.neep.shop/html/portal/index.html#



| 中国电力设备信息网 新金禾 | www.cpeinet.com.cn | tianhe xinjinhe | sythzdh2014 sythzdh2015 | 长春东南 2017/11/23需申请C类 | 有效期1年2018/9/26升级A类会员缴费6500元2019/10/15 B类500元 2020.10.15缴费500元 |
| ------------------------- | ------------------ | --------------- | ----------------------- | ---------------------------- | ------------------------------------------------------------ |
|                           |                    |                 |                         |                              |                                                              |

| 国家电网公司电子商务平台谷歌浏览器 | https://ecp.sgcc.com.cn/ecp2.0/portal/#/http://ecp.sgcc.com.cn | 912101027555424491 Tianhe2015 | Sythzdh-2022-Y sythzdh-2020证书密码12345678 | 新平台2.0电话：010-63411000旧平台1.0 | 电子钥匙续费350元2020.6.29至2023.6.29 |
| ---------------------------------- | ------------------------------------------------------------ | ----------------------------- | ------------------------------------------- | ------------------------------------ | ------------------------------------- |
|                                    |                                                              |                               |                                             |                                      |                                       |





---

# AVC/AGC 招标公告自动监控

已于 2026-10-23 立项建成,每天 08:30 / 14:30 自动检查以下网站的 AVC、AGC、自动电压控制、自动发电控制相关招标公告,发现新公告自动发邮件到 1783602@qq.com:

| 网站 | 检查方式 | 需登录 |
|------|---------|--------|
| 国能E招 chnenergybidding.com.cn | 静态HTML抓取(招标/非招标/变更公告 各前3页) | 否 |
| 华电 chdtp.com | ego-browser 真实浏览器(瑞数反爬),站内搜索 iframepage4 | 否 |
| 大唐 cdt-ec.com | 由犀维网 cweme.cn 公开API覆盖(招标/变更/非招标) | 否 |
| 国能E购 neep.shop | 无公开可搜索公告列表,国能招标已在国能E招覆盖 | - |

## 文件结构
- `run_check.py` — 主脚本: 抓取→关键词过滤→去重→邮件通知(邮件两段式确认已内置)
- `scripts/check_chd_cweme.mjs` — ego-browser 脚本(华电+犀维),产出 `data/browser_results.json`
- `data/seen.json` — 已见公告去重库(勿手动编辑)
- `data/last_run.json` — 最近一次运行结果
- 定时任务: `avc-agc-bid-watch`(每天 8:30/14:30,见 Claude 应用 Scheduled 栏)

## 手动操作
```bash
cd C:\work\bidweb
python run_check.py             # 日常检查,新公告自动发邮件
python run_check.py --no-email  # 只看结果不发邮件
python run_check.py --baseline  # 重置基线(只建档不通知)
```

修改通知邮箱: 改 run_check.py 里的 NOTIFY_TO;修改关键词: 改 KEYWORD_RE;
修改时间/暂停: 在 Claude 应用 Scheduled 栏编辑 avc-agc-bid-watch 任务。

注意: 定时任务仅在 Claude 应用打开时运行;应用关闭期间错过的检查会在下次打开时补跑一次。