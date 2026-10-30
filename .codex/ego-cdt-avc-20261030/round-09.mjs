const task = await taskSpace(21);
const page = task.page("p1");

await page.evaluate(() => search());
await page.waitForFunction(
  () => !document.body.innerText.includes("无数据"),
  undefined,
  { timeout: 10000 },
).catch(() => null);

const state = await page.evaluate(async () => {
  const rows = [...document.querySelectorAll("table tr, .layui-table tr")]
    .map((node) => node.innerText.replace(/\s+/g, " ").trim())
    .filter((text) => text.includes("AVC") || text.includes("项目名称") || text.includes("无数据"));

  const request = new URLSearchParams({
    page: "1",
    limit: "10",
    messagetype: "0",
    pro_bidding_mothod: $("#pro_bidding_mothod").val() || "",
    message_title: $("#title").val() || "",
    purchase_unit: "",
    purchase_unit_agent: "",
    message_no: "",
    purchase_code: "",
    startDate: "",
    endDate: "",
    purchase_type: "",
  }).toString();

  const response = await fetch("/notice/moreController/getList", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
    body: request,
  });
  const responseText = await response.text();

  return {
    titleValue: $("#title").val(),
    rows,
    request,
    responseStatus: response.status,
    responseText: responseText.slice(0, 8000),
  };
});

console.log(JSON.stringify(state, null, 2));
