export const handler = async () => {
  return {
    statusCode: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      ok: true,
      model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash"
    })
  };
};
