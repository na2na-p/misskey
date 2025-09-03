/*
 * SPDX-FileCopyrightText: na2na-p
 * SPDX-License-Identifier: AGPL-3.0-only
 */
// @ts-check
import { DataSource } from 'typeorm';
import chalk from 'chalk';
import { loadConfig } from '../built/config.js';
import { entities } from '../built/postgres.js';
import { isConcurrentIndexMigrationEnabled } from '../migration/js/migration-config.js';

/**
 * マイグレーションドライラン機能
 * 実際にマイグレーションを実行せずに、実行予定のマイグレーションを確認する
 */
class MigrationDryRun {
	constructor(options = {}) {
		this.config = loadConfig();
		this.dataSource = null;
		this.outputFormat = options.outputFormat || 'human';
		this.results = {
			status: 'success',
			timestamp: new Date().toISOString(),
			database: {
				host: this.config.db.host,
				port: this.config.db.port,
				database: this.config.db.db
			},
			migrations: {
				pending: [],
				executed: [],
				total_pending: 0,
				total_executed: 0
			},
			errors: []
		};
	}

	async initializeDataSource() {
		try {
			this.dataSource = new DataSource({
				type: 'postgres',
				host: this.config.db.host,
				port: this.config.db.port,
				username: this.config.db.user,
				password: this.config.db.pass,
				database: this.config.db.db,
				extra: this.config.db.extra,
				entities: entities,
				migrations: ['migration/*.js'],
				migrationsTransactionMode: isConcurrentIndexMigrationEnabled() ? 'each' : 'all',
			});

			await this.dataSource.initialize();
			return true;
		} catch (error) {
			this.results.status = 'error';
			this.results.errors.push({
				type: 'database_connection',
				message: error.message,
				stack: error.stack,
			});
			return false;
		}
	}

	async checkMigrationStatus() {
		try {
			// 実行済みマイグレーションを取得
			const executedMigrations = await this.dataSource.query(
				'SELECT * FROM "migrations" ORDER BY "timestamp" ASC',
			);

			// 実行済みマイグレーションの情報を格納
			this.results.migrations.executed = executedMigrations.map(migration => ({
				id: migration.id,
				timestamp: migration.timestamp,
				name: migration.name,
				executed_at: migration.timestamp,
			}));

			// TypeORMのrunMigrationsメソッドをdryRunモードで実行して未実行マイグレーションを取得
			try {
				// showMigrationsの結果を確認
				const hasPendingMigrations = await this.dataSource.showMigrations();

				if (hasPendingMigrations === true) {
					// 利用可能なマイグレーションファイルを取得
					const availableMigrations = this.dataSource.migrations;
					const executedNames = new Set(executedMigrations.map(m => m.name));

					// 未実行マイグレーションを特定
					const pendingMigrations = availableMigrations.filter(migration => {
						const migrationName = migration.name || migration.constructor?.name;
						return migrationName && !executedNames.has(migrationName);
					});

					// 未実行マイグレーションの詳細情報を取得
					for (const migration of pendingMigrations) {
						const migrationName = migration.name || migration.constructor?.name || 'Unknown';
						const migrationInfo = {
							name: migrationName,
							timestamp: this.extractTimestampFromName(migrationName),
							file_path: `migration/${migrationName}.js`,
							description: migrationName,
						};

						this.results.migrations.pending.push(migrationInfo);
					}
				}
			} catch (showMigrationsError) {
				const availableMigrations = this.dataSource.migrations;
				const executedNames = new Set(executedMigrations.map(m => m.name));

				const pendingMigrations = availableMigrations.filter(migration => {
					const migrationName = migration.name || migration.constructor?.name;
					return migrationName && !executedNames.has(migrationName);
				});

				for (const migration of pendingMigrations) {
					const migrationName = migration.name || migration.constructor?.name || 'Unknown';
					const migrationInfo = {
						name: migrationName,
						timestamp: this.extractTimestampFromName(migrationName),
						file_path: `migration/${migrationName}.js`,
						description: migrationName,
					};

					this.results.migrations.pending.push(migrationInfo);
				}
			}

			this.results.migrations.total_pending = this.results.migrations.pending.length;
			this.results.migrations.total_executed = this.results.migrations.executed.length;
		} catch (error) {
			this.results.status = 'error';
			this.results.errors.push({
				type: 'migration_check',
				message: error.message,
				stack: error.stack,
			});
		}
	}

	/**
	 * マイグレーション名からタイムスタンプを抽出
	 * @param {string} name
	 * @returns {number|null}
	 */
	extractTimestampFromName(name) {
		if (!name || typeof name !== 'string') {
			return null;
		}
		const match = name.match(/^(\d+)/);
		return match ? parseInt(match[1]) : null;
	}

	/**
	 * マイグレーションの説明を取得
	 */
	async getMigrationDescription(migration) {
		try {
			// マイグレーションクラスから説明を取得（可能な場合）
			if (migration.constructor && migration.constructor.name) {
				return migration.constructor.name;
			}
			return migration.name || 'No description available';
		} catch (error) {
			return 'Description unavailable';
		}
	}

	/**
	 * データベース接続を閉じる
	 */
	async closeConnection() {
		if (this.dataSource && this.dataSource.isInitialized) {
			await this.dataSource.destroy();
		}
	}

	/**
	 * ドライランを実行
	 */
	async run() {
		// JSON出力時は余計な標準出力を抑制
		if (this.outputFormat !== 'json') {
			console.log(chalk.blue('🔍 マイグレーションドライランを開始します...'));
		}

		// データベース接続
		const connected = await this.initializeDataSource();
		if (!connected) {
			return this.results;
		}

		// マイグレーション状態確認
		await this.checkMigrationStatus();

		// 接続を閉じる
		await this.closeConnection();

		return this.results;
	}

	/**
	 * 結果を人間が読みやすい形式で出力
	 */
	printHumanReadableResults() {
		console.log('\n' + chalk.bold('=== マイグレーションドライラン結果 ==='));
		console.log(chalk.gray(`実行時刻: ${this.results.timestamp}`));
		console.log(chalk.gray(`データベース: ${this.results.database.host}:${this.results.database.port}/${this.results.database.database}`));

		if (this.results.status === 'error') {
			console.log(chalk.red('\n❌ エラーが発生しました:'));
			this.results.errors.forEach(error => {
				console.log(chalk.red(`  - ${error.type}: ${error.message}`));
			});
			return;
		}

		console.log(chalk.green(`\n✅ ステータス: ${this.results.status}`));

		// 実行済みマイグレーション
		console.log(chalk.blue(`\n📋 実行済みマイグレーション: ${this.results.migrations.total_executed}件`));
		if (this.results.migrations.executed.length > 0) {
			this.results.migrations.executed.slice(-5).forEach(migration => {
				console.log(chalk.gray(`  - ${migration.name} (${migration.timestamp})`));
			});
			if (this.results.migrations.executed.length > 5) {
				console.log(chalk.gray(`  ... および他${this.results.migrations.executed.length - 5}件`));
			}
		}

		// 未実行マイグレーション
		console.log(chalk.yellow(`\n⏳ 未実行マイグレーション: ${this.results.migrations.total_pending}件`));
		if (this.results.migrations.pending.length > 0) {
			this.results.migrations.pending.forEach(migration => {
				console.log(chalk.yellow(`  - ${migration.name} (${migration.timestamp})`));
				console.log(chalk.gray(`    ファイル: ${migration.file_path}`));
			});
		} else {
			console.log(chalk.green('  すべてのマイグレーションが実行済みです'));
		}

		console.log('\n' + chalk.bold('=== ドライラン完了 ==='));
	}

	/**
	 * 結果をJSON形式で出力
	 */
	printJsonResults() {
		console.log(JSON.stringify(this.results, null, 2));
	}
}

/**
 * CLI実行部分
 */
async function main() {
	const args = process.argv.slice(2);
	const outputFormat = args.includes('--json') ? 'json' : 'human';
	const showHelp = args.includes('--help') || args.includes('-h');

	if (showHelp) {
		console.log(chalk.bold('マイグレーションドライラン'));
		console.log('実際にマイグレーションを実行せずに、実行予定のマイグレーションを確認します。\n');
		console.log(chalk.bold('使用方法:'));
		console.log('  node scripts/migration-dry-run.mjs [オプション]\n');
		console.log(chalk.bold('オプション:'));
		console.log('  --json    結果をJSON形式で出力');
		console.log('  --help    このヘルプを表示');
		return;
	}

	const dryRun = new MigrationDryRun({ outputFormat });

	try {
		const results = await dryRun.run();

		if (outputFormat === 'json') {
			dryRun.printJsonResults();
		} else {
			dryRun.printHumanReadableResults();
		}

		// エラーがある場合は終了コード1で終了
		if (results.status === 'error') {
			process.exit(1);
		}
	} catch (error) {
		if (outputFormat === 'json') {
			// JSON出力時はエラーもJSON形式で出力
			console.log(JSON.stringify({
				status: 'error',
				timestamp: new Date().toISOString(),
				errors: [{
					type: 'unexpected_error',
					message: error.message,
					stack: error.stack
				}]
			}, null, 2));
		} else {
			console.error(chalk.red('予期しないエラーが発生しました:'), error);
		}
		process.exit(1);
	}
}

// スクリプトが直接実行された場合のみmainを実行
if (import.meta.url === `file://${process.argv[1]}`) {
	main();
}

export { MigrationDryRun };
