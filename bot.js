const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { GoalNear } = goals;
const collectBlock = require('mineflayer-collectblock').plugin;
const tool = require('mineflayer-tool').plugin;
const Vec3 = require('vec3');

const config = {
  host: 'AidensServer.aternos.me',
  port: 51889,
  username: 'HumanBot',
  version: '1.20.1',
  baseSize: 7,
  roamRadius: 15,
  resourceGoals: {
    wood: 20,
    stone: 20,
    coal: 15,
    food: 10,
  }
};

function createBot() {
  const bot = mineflayer.createBot({
    host: config.host,
    port: config.port,
    username: config.username,
    version: config.version
  });

  bot.loadPlugin(pathfinder);
  bot.loadPlugin(collectBlock);
  bot.loadPlugin(tool);

  let mcData;
  let basePosition;
  let movements;

  bot.once('spawn', () => {
    console.log('Bot spawned!');

    mcData = require('minecraft-data')(bot.version);
    movements = new Movements(bot, mcData);
    bot.pathfinder.setMovements(movements);

    basePosition = bot.entity.position.floored();

    survivalLoop();
  });

  async function survivalLoop() {
    try {
      await checkHungerAndEat();
      await gatherResources();
      await craftTools();
      await buildBase();
      await defendBase();
      await roamAround();
    } catch (err) {
      console.log('Error in survival loop:', err);
    }
    setTimeout(survivalLoop, 30000); // Repeat every 30s
  }

  async function checkHungerAndEat() {
    if (bot.food < 14) { // below 70%
      const foodItem = bot.inventory.items().find(item => isFood(item));
      if (foodItem) {
        try {
          await bot.equip(foodItem, 'hand');
          await bot.consume();
          console.log('Eating food to restore hunger');
        } catch (err) {
          console.log('Failed to eat:', err.message);
        }
      } else {
        console.log('No food to eat');
      }
    }
  }

  function isFood(item) {
    return item && item.foodPoints && item.name !== 'rotten_flesh';
  }

  async function gatherResources() {
    console.log('Gathering resources...');
    await collectCount('oak_log', config.resourceGoals.wood);
    await collectCount('stone', config.resourceGoals.stone);
    await collectCount('coal_ore', config.resourceGoals.coal);

    // Also collect food (like carrots, potatoes, apples, raw chicken, etc)
    await collectFood(config.resourceGoals.food);
  }

  async function collectCount(blockName, goalCount) {
    const blockId = mcData.blocksByName[blockName]?.id;
    if (!blockId) {
      console.log(`Unknown block name: ${blockName}`);
      return;
    }
    let count = bot.inventory.count(blockId);
    while (count < goalCount) {
      const block = bot.findBlock({
        matching: blockId,
        maxDistance: 32
      });
      if (!block) {
        console.log(`No ${blockName} found nearby`);
        break;
      }
      try {
        await bot.collectBlock.collect(block);
        count = bot.inventory.count(blockId);
        console.log(`Collected ${count}/${goalCount} ${blockName}`);
      } catch (err) {
        console.log(`Error collecting ${blockName}:`, err.message);
        break;
      }
    }
  }

  async function collectFood(goalCount) {
    // Food items we accept
    const foodItems = ['apple', 'carrot', 'potato', 'bread', 'cooked_beef', 'cooked_chicken', 'raw_chicken', 'raw_beef', 'pumpkin_pie'];
    let totalFoodCount = bot.inventory.items().filter(item => foodItems.includes(item.name)).reduce((a,b) => a + b.count, 0);

    while (totalFoodCount < goalCount) {
      const block = bot.findBlock({
        matching: block => foodItems.includes(block.name),
        maxDistance: 20
      });
      if (!block) {
        console.log('No food blocks nearby to collect');
        break;
      }
      try {
        await bot.collectBlock.collect(block);
        totalFoodCount = bot.inventory.items().filter(item => foodItems.includes(item.name)).reduce((a,b) => a + b.count, 0);
        console.log(`Collected ${totalFoodCount}/${goalCount} food items`);
      } catch (err) {
        console.log('Error collecting food:', err.message);
        break;
      }
    }
  }

  async function craftTools() {
    console.log('Crafting tools...');
    const craftingTable = bot.inventory.items().find(i => i.name === 'crafting_table');
    if (!craftingTable) {
      await craftItem('crafting_table', 1);
    }

    // Craft stone pickaxe if possible
    if (!bot.inventory.items().some(i => i.name.includes('pickaxe'))) {
      await craftItem('wooden_pickaxe', 1);
    }
    const stoneCount = bot.inventory.count(mcData.itemsByName.stone.id);
    if (stoneCount >= 3) {
      await craftItem('stone_pickaxe', 1);
    }

    // Craft sword
    if (!bot.inventory.items().some(i => i.name.includes('sword'))) {
      await craftItem('wooden_sword', 1);
    }
  }

  async function craftItem(itemName, quantity) {
    const recipes = bot.recipesAll(mcData.itemsByName[itemName]?.id);
    if (!recipes || recipes.length === 0) {
      console.log(`No recipe found for ${itemName}`);
      return;
    }
    try {
      await bot.craft(recipes[0], quantity, null);
      console.log(`Crafted ${quantity} ${itemName}(s)`);
    } catch (err) {
      console.log(`Failed to craft ${itemName}:`, err.message);
    }
  }

  async function buildBase() {
    console.log('Building base...');
    const pos = basePosition;
    const halfSize = Math.floor(config.baseSize / 2);
    const wallHeight = 3;

    const logItem = bot.inventory.items().find(i => i.name === 'oak_log');
    if (!logItem) {
      console.log('No logs to build base');
      return;
    }

    // Build walls
    for (let y = 0; y < wallHeight; y++) {
      for (let x = -halfSize; x <= halfSize; x++) {
        await placeBlockIfEmpty(pos.offset(x, y, -halfSize), logItem);
        await placeBlockIfEmpty(pos.offset(x, y, halfSize), logItem);
      }
      for (let z = -halfSize + 1; z <= halfSize - 1; z++) {
        await placeBlockIfEmpty(pos.offset(-halfSize, y, z), logItem);
        await placeBlockIfEmpty(pos.offset(halfSize, y, z), logItem);
      }
    }

    // Place door
    const doorPos = pos.offset(0, 0, -halfSize);
    await placeDoor(doorPos);
  }

  async function placeBlockIfEmpty(position, item) {
    const block = bot.blockAt(position);
    if (block && block.name !== 'air') return;

    try {
      await bot.equip(item, 'hand');
      await bot.placeBlock(bot.blockAt(position.offset(0, -1, 0)), position);
      console.log(`Placed block at ${position}`);
    } catch (err) {
      console.log(`Failed to place block at ${position}: ${err.message}`);
    }
  }

  async function placeDoor(position) {
    let doorItem = bot.inventory.items().find(i => i.name.includes('door'));
    if (!doorItem) {
      await craftItem('oak_door', 1);
      doorItem = bot.inventory.items().find(i => i.name.includes('door'));
      if (!doorItem) {
        console.log('No door to place');
        return;
      }
    }
    try {
      await bot.equip(doorItem, 'hand');
      await bot.placeBlock(bot.blockAt(position.offset(0, -1, 0)), position);
      console.log('Door placed');
    } catch (err) {
      console.log('Failed to place door:', err.message);
    }
  }

  async function defendBase() {
    const sword = bot.inventory.items().find(i => i.name.includes('sword'));
    if (sword) await bot.equip(sword, 'hand');

    const mob = bot.nearestEntity(e => e.type === 'mob' && e.position.distanceTo(bot.entity.position) < 10 && e.mobType !== 'Armor Stand');

    if (mob) {
      console.log(`Attacking mob: ${mob.name}`);
      try {
        await bot.attack(mob);
      } catch (err) {
        console.log('Attack failed:', err.message);
      }
    }
  }

  async function roamAround() {
    const pos = basePosition;
    const x = pos.x + (Math.random() * config.roamRadius * 2 - config.roamRadius);
    const z = pos.z + (Math.random() * config.roamRadius * 2 - config.roamRadius);
    const y = pos.y;
    bot.pathfinder.setGoal(new GoalNear(Math.floor(x), Math.floor(y), Math.floor(z), 1));
  }

  bot.on('health', () => {
    if (bot.food < 6) { // Danger hunger level
      console.log('Warning: low hunger!');
    }
  });

  bot.on('error', err => console.log('Error:', err.message));
  bot.on('end', () => {
    console.log('Disconnected, reconnecting...');
    setTimeout(createBot, 5000);
  });

  bot.on('kicked', (reason) => {
    console.log('Kicked from server:', reason);
  });

  bot.on('chat', (username, message) => {
    if (username === bot.username) return;
    console.log(`<${username}> ${message}`);
  });
}

createBot();
