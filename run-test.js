import { readFileSync } from "fs";
const content = readFileSync("src/view/CardItem.svelte.test.ts", "utf-8");
console.log(content.split("renders file-kind icon metadata")[1].slice(0, 500));
