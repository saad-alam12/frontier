/** Load the example graph into a database: `npm run seed [path/to/frontier.db]` (default ~/Frontier/frontier.db). */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../backend/store/db';
import { seedExampleGraph } from '../backend/store/seed/exampleGraph';
import { countNodes, listChains } from '../backend/store/world';

const path = process.argv[2] ?? join(homedir(), 'Frontier', 'frontier.db');
const db = openDatabase(path);
seedExampleGraph(db);
console.log(`${path}: ${countNodes(db)} nodes, ${listChains(db).length} chains`);
db.close();
