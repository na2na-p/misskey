/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * YAMLファイルをJSONファイルに変換するスクリプト
 * ビルド前に実行し、ランタイムにjs-yamlを含まないようにする
 */

import fs from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as loadYaml } from 'js-yaml';

const _filename = fileURLToPath(import.meta.url);
const _dirname = dirname(_filename);

const configDir = resolve(_dirname, '../../../.config');
// root FS を read-only で運用すると built/ へ書けないため、書き込み可能な
// volume へ出力先を逃がせるようにする。解決規則は config.ts の
// compiledConfigFilePath と一致させること。ずれると起動時に設定を読めない。
const OUTPUT_PATH = process.env.MISSKEY_COMPILED_CONFIG_PATH
	? resolve(process.env.MISSKEY_COMPILED_CONFIG_PATH)
	: resolve(_dirname, '../../../built/.config.json');

// TODO: yamlのパースに失敗したときのエラーハンドリング

/**
 * YAMLファイルをJSONファイルに変換
 * @param {string} ymlPath - YAMLファイルのパス
 */
function yamlToJson(ymlPath) {
	if (!fs.existsSync(ymlPath)) {
		console.warn(`YAML file not found: ${ymlPath}`);
		return;
	}

	console.log(`${ymlPath} → ${OUTPUT_PATH}`);

	const yamlContent = fs.readFileSync(ymlPath, 'utf-8');
	const jsonContent = loadYaml(yamlContent);
	if (!fs.existsSync(dirname(OUTPUT_PATH))) {
		fs.mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
	}
	fs.writeFileSync(OUTPUT_PATH, JSON.stringify({
		'_NOTE_': 'This file is auto-generated from YAML file. DO NOT EDIT.',
		...jsonContent,
	}), 'utf-8');
}

if (process.env.MISSKEY_CONFIG_YML) {
	const customYmlPath = resolve(configDir, process.env.MISSKEY_CONFIG_YML);
	yamlToJson(customYmlPath);
} else {
	yamlToJson(resolve(configDir, process.env.NODE_ENV === 'test' ? 'test.yml' : 'default.yml'));
}

console.log('Configuration compiled ✓');
