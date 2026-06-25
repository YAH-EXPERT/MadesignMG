async function fetchImage(url: string) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' } });
    const text = await res.text();
    // Look for common istock image URL patterns
    const match = text.match(/https:\/\/media\.istockphoto\.com\/id\/\d+\/fr\/photo\/[^\.]+\.jpg\?[^"]+/i) || text.match(/https:\/\/media\.istockphoto\.com\/id\/[^"]+/);
    if (match) {
      console.log(url, "\n=>", match[0]);
    } else {
      console.log(url, "=> No image found");
    }
  } catch(e) {
    console.error(e);
  }
}
async function run() {
  await fetchImage("https://www.istockphoto.com/photo/aerial-photo-of-astrakhan-waterfront-star-shaped-ornament-with-peter-the-great-gm2228756548-644522418");
  await fetchImage("https://www.istockphoto.com/photo/overhead-view-of-bayfront-park-in-miami-gm2177507443-596909742");
}
run();
