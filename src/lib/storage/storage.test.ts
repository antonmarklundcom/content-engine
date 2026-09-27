import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { hostingerConfig, hostingerKeyFromUrl, isHostingerKey } from "./hostinger";
import { localDriver } from "./local";
import {
  assetFileName,
  captureFolder,
  higgsfieldInboxFolder,
  postAssetPath,
  postFolder,
  thumbnailPath,
} from "./paths";
import { mediaRootStatus, splitRelative, toRelative } from "./root";

/** [O10] The §1.41 folder layout, the path-safety rules and the local driver's typed results. */

const DATE = new Date("2026-09-27T10:00:00Z");

test("post folders follow <brand>/<handle|_brand>/<YYYY-MM>/<post-id>-<slug>", () => {
  assert.equal(
    postFolder({
      brandId: "guide",
      accountHandle: "@Paraguay.Residency",
      postId: 41,
      title: "5 Myths About Cédula!",
      date: DATE,
    }),
    "guide/paraguay-residency/2026-09/41-5-myths-about-cedula",
  );
  assert.equal(
    postFolder({ brandId: "guide", postId: 7, title: "", date: DATE }),
    "guide/_brand/2026-09/7-post",
  );
  assert.equal(
    postAssetPath(
      { brandId: "guide", accountHandle: null, postId: 7, title: "x", date: DATE },
      3,
      "Slide Three",
      ".PNG",
    ),
    "guide/_brand/2026-09/7-x/03-slide-three.png",
  );
  assert.equal(assetFileName(12, "../../etc/passwd", "sh/../x"), "12-etc-passwd.shx");
  assert.equal(higgsfieldInboxFolder(DATE), "_inbox/higgsfield/2026-09-27");
  assert.equal(captureFolder(99), "captures/99");
  assert.equal(thumbnailPath("AB".padEnd(64, "c")), `_thumbs/ab/${"ab".padEnd(64, "c")}.webp`);
});

test("a free-text segment can never be a dot-name or one of the app's _folders", () => {
  const folder = postFolder({
    brandId: "_inbox",
    accountHandle: "..",
    postId: 1,
    title: "..",
    date: DATE,
  });
  for (const part of folder.split("/")) {
    assert.ok(part !== "." && part !== "..", folder);
  }
  assert.equal(folder.split("/")[0], "inbox");
});

test("relative paths split into safe segments or not at all", () => {
  assert.deepEqual(splitRelative("a/b\\c.png"), ["a", "b", "c.png"]);
  assert.equal(splitRelative("a/../b"), null);
  assert.equal(splitRelative("C:/x"), null);
  assert.equal(splitRelative(""), null);
  assert.equal(toRelative("/root", "/root/a/b.png"), "a/b.png");
  assert.equal(toRelative("/root", "/elsewhere/b.png"), null);
});

test("the public endpoint's keys and URLs are recognised exactly", () => {
  const key = `files/2026/09/${"a".repeat(32)}.jpg`;
  assert.ok(isHostingerKey(key));
  assert.ok(!isHostingerKey("files/2026/09/../../config.php"));
  const config = {
    uploadUrl: "https://m.test/upload.php",
    token: "t".repeat(32),
    publicBase: "https://m.test",
  };
  assert.equal(hostingerKeyFromUrl(`https://m.test/${key}`, config), key);
  assert.equal(hostingerKeyFromUrl(`https://evil.test/${key}`, config), null);
  assert.equal(hostingerConfig({}), null);
  assert.deepEqual(
    hostingerConfig({
      MEDIA_UPLOAD_URL: "https://m.test/upload.php",
      MEDIA_UPLOAD_TOKEN: "x",
      MEDIA_PUBLIC_BASE: "https://m.test/",
    }),
    { uploadUrl: "https://m.test/upload.php", token: "x", publicBase: "https://m.test" },
  );
});

test("the local driver answers missing for an absent root and never writes outside it", async () => {
  const base = mkdtempSync(path.join(tmpdir(), "ce-storage-"));
  try {
    const absent = path.join(base, "unplugged");
    assert.equal(await mediaRootStatus(absent), "missing");
    const offline = localDriver(absent);
    for (const result of [
      await offline.put("a.png", Buffer.from("x")),
      await offline.get("a.png"),
      await offline.exists("a.png"),
      await offline.remove("a.png"),
    ]) {
      assert.equal(result.ok, false);
      assert.equal(!result.ok && result.reason, "missing");
    }

    const root = path.join(base, "root");
    mkdirSync(root);
    const outside = path.join(base, "outside");
    mkdirSync(outside);
    symlinkSync(outside, path.join(root, "escape"));
    assert.equal(await mediaRootStatus(root), "ok");
    const driver = localDriver(root);

    const put = await driver.put("guide/_brand/2026-09/1-x/01-a.png", Buffer.from("hello"));
    assert.deepEqual(put, { ok: true, key: "guide/_brand/2026-09/1-x/01-a.png", bytes: 5 });
    const again = await driver.put("guide/_brand/2026-09/1-x/01-a.png", Buffer.from("other"));
    assert.equal(!again.ok && again.reason, "rejected", "no silent overwrite");
    const got = await driver.get("guide/_brand/2026-09/1-x/01-a.png");
    assert.equal(got.ok && got.data.toString(), "hello");

    for (const key of ["../outside/x.png", "escape/x.png", "a/../../x.png", "C:/x.png"]) {
      const result = await driver.put(key, Buffer.from("x"));
      assert.equal(result.ok, false, key);
    }
    writeFileSync(path.join(outside, "secret.png"), "secret");
    const leaked = await driver.get("escape/secret.png");
    assert.equal(!leaked.ok && leaked.reason, "not_found");

    assert.deepEqual(await driver.exists("nope.png"), { ok: true, exists: false });
    assert.deepEqual(await driver.remove("guide/_brand/2026-09/1-x/01-a.png"), {
      ok: true,
      removed: true,
    });
    assert.deepEqual(await driver.remove("guide/_brand/2026-09/1-x/01-a.png"), {
      ok: true,
      removed: false,
    });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
