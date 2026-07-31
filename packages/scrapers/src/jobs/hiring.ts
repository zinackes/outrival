// Barrel for the hiring-velocity pure logic (department bucketing + inflection
// detection), exposed as `@outrival/scrapers/jobs-hiring` so the worker can import
// it without pulling the browser/cheerio stack.
export * from "./departments";
export * from "./velocity";
export * from "./footprint";
export * from "./salary";
