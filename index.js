
const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  ChannelType,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder
} = require("discord.js");

const fs = require("node:fs");
const path = require("node:path");

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID || "";

if (!TOKEN || !CLIENT_ID) {
  console.error("ضع TOKEN و CLIENT_ID في Environment Variables.");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration
  ],
  partials: [Partials.Channel, Partials.Message]
});

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "security.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "{}");

let db = {};

try {
  db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
} catch {
  db = {};
}

function saveDB() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

function getConfig(guildId) {
  if (!db[guildId]) {
    db[guildId] = {
      logChannel: null,
      whitelist: [],
      lockdown: false,
      antiSpam: true,
      antiRaid: true,
      antiNuke: true
    };
    saveDB();
  }

  return db[guildId];
}

const spamTracker = new Map();
const raidTracker = new Map();
const actionTracker = new Map();

function isTrusted(member, config) {
  if (!member) return false;

  return (
    member.id === member.guild.ownerId ||
    config.whitelist.includes(member.id) ||
    member.permissions.has(PermissionsBitField.Flags.Administrator)
  );
}

async function logEvent(guild, title, description, color = 0x6D28D9) {
  const config = getConfig(guild.id);

  if (!config.logChannel) return;

  const channel = guild.channels.cache.get(config.logChannel);
  if (!channel || !channel.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`🛡️ Silfer Security | ${title}`)
    .setDescription(description.slice(0, 4000))
    .setTimestamp();

  try {
    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error("تعذر إرسال سجل الحماية:", error.message);
  }
}

async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName("security")
      .setDescription("لوحة تحكم Silfer Security")
      .addSubcommand(s =>
        s.setName("setup")
          .setDescription("إعداد نظام الحماية وإنشاء روم السجلات")
      )
      .addSubcommand(s =>
        s.setName("status")
          .setDescription("عرض حالة أنظمة الحماية")
      )
      .addSubcommand(s =>
        s.setName("lockdown")
          .setDescription("قفل أو فتح إرسال الرسائل في السيرفر")
          .addStringOption(o =>
            o.setName("action")
              .setDescription("اختر الإجراء")
              .setRequired(true)
              .addChoices(
                { name: "تفعيل القفل", value: "on" },
                { name: "إلغاء القفل", value: "off" }
              )
          )
      )
      .addSubcommand(s =>
        s.setName("whitelist-add")
          .setDescription("إضافة عضو إلى قائمة السماح")
          .addUserOption(o =>
            o.setName("member")
              .setDescription("العضو")
              .setRequired(true)
          )
      )
      .addSubcommand(s =>
        s.setName("whitelist-remove")
          .setDescription("حذف عضو من قائمة السماح")
          .addUserOption(o =>
            o.setName("member")
              .setDescription("العضو")
              .setRequired(true)
          )
      )
      .addSubcommand(s =>
        s.setName("whitelist-list")
          .setDescription("عرض قائمة السماح")
      )
      .setDefaultMemberPermissions(
        PermissionsBitField.Flags.Administrator
      )
      .toJSON()
  ];

  const rest = new REST({ version: "10" }).setToken(TOKEN);

  if (GUILD_ID) {
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );
    console.log("تم تسجيل أوامر السيرفر المحدد.");
  } else {
    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: commands }
    );
    console.log("تم تسجيل الأوامر العامة.");
  }
}

client.once("ready", async () => {
  console.log(`Silfer Security يعمل باسم ${client.user.tag}`);

  client.user.setPresence({
    activities: [{ name: "Silfer Security | حماية السيرفرات" }],
    status: "online"
  });

  try {
    await registerCommands();
  } catch (error) {
    console.error("خطأ تسجيل الأوامر:", error);
  }
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "security") return;

  const guild = interaction.guild;

  if (!guild) {
    return interaction.reply({
      content: "هذا الأمر يعمل داخل السيرفر فقط.",
      ephemeral: true
    });
  }

  if (!interaction.memberPermissions?.has(
    PermissionsBitField.Flags.Administrator
  )) {
    return interaction.reply({
      content: "هذا الأمر مخصص للإدارة.",
      ephemeral: true
    });
  }

  const config = getConfig(guild.id);
  const sub = interaction.options.getSubcommand();

  if (sub === "setup") {
    await interaction.deferReply({ ephemeral: true });

    let channel = guild.channels.cache.find(
      c => c.name === "silfer-security-logs" &&
           c.type === ChannelType.GuildText
    );

    if (!channel) {
      channel = await guild.channels.create({
        name: "silfer-security-logs",
        type: ChannelType.GuildText,
        topic: "سجلات الحماية - Silfer Security",
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            deny: [PermissionsBitField.Flags.ViewChannel]
          },
          {
            id: client.user.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.EmbedLinks,
              PermissionsBitField.Flags.ReadMessageHistory
            ]
          }
        ]
      });
    }

    config.logChannel = channel.id;
    saveDB();

    await logEvent(
      guild,
      "اكتمل الإعداد",
      "تم إعداد نظام الحماية بنجاح."
    );

    return interaction.editReply(
      `تم إعداد Silfer Security.\nروم السجلات: ${channel}`
    );
  }

  if (sub === "status") {
    const embed = new EmbedBuilder()
      .setColor(0x6D28D9)
      .setTitle("🛡️ Silfer Security")
      .setDescription(
        `**حماية السبام:** ${config.antiSpam ? "مفعلة" : "معطلة"}\n` +
        `**حماية الغارات:** ${config.antiRaid ? "مفعلة" : "معطلة"}\n` +
        `**رصد الحذف الإداري:** ${config.antiNuke ? "مفعل" : "معطل"}\n` +
        `**وضع القفل:** ${config.lockdown ? "مفعل" : "معطل"}\n` +
        `**عدد الأعضاء بقائمة السماح:** ${config.whitelist.length}\n` +
        `**روم السجلات:** ${config.logChannel ? `<#${config.logChannel}>` : "لم يتم إعداده"}`
      )
      .setTimestamp();

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (sub === "whitelist-add") {
    const user = interaction.options.getUser("member", true);

    if (!config.whitelist.includes(user.id)) {
      config.whitelist.push(user.id);
      saveDB();
    }

    return interaction.reply({
      content: `تمت إضافة ${user} إلى قائمة السماح.`,
      ephemeral: true
    });
  }

  if (sub === "whitelist-remove") {
    const user = interaction.options.getUser("member", true);

    config.whitelist = config.whitelist.filter(id => id !== user.id);
    saveDB();

    return interaction.reply({
      content: `تم حذف ${user} من قائمة السماح.`,
      ephemeral: true
    });
  }

  if (sub === "whitelist-list") {
    const list = config.whitelist.length
      ? config.whitelist.map(id => `<@${id}> — \`${id}\``).join("\n")
      : "قائمة السماح فارغة.";

    return interaction.reply({
      content: `**قائمة السماح**\n${list}`,
      ephemeral: true
    });
  }

  if (sub === "lockdown") {
    const action = interaction.options.getString("action", true);
    await interaction.deferReply({ ephemeral: true });

    const enable = action === "on";
    config.lockdown = enable;

    let changed = 0;
    let failed = 0;

    for (const channel of guild.channels.cache.values()) {
      if (channel.type !== ChannelType.GuildText &&
          channel.type !== ChannelType.GuildAnnouncement) continue;

      try {
        await channel.permissionOverwrites.edit(
          guild.roles.everyone,
          {
            SendMessages: enable ? false : null,
            SendMessagesInThreads: enable ? false : null,
            CreatePublicThreads: enable ? false : null,
            CreatePrivateThreads: enable ? false : null
          }
        );
        changed++;
      } catch {
        failed++;
      }
    }

    saveDB();

    await logEvent(
      guild,
      enable ? "تم تفعيل القفل" : "تم إلغاء القفل",
      `بواسطة ${interaction.user.tag}\nالقنوات التي تمت معالجتها: ${changed}\nالأخطاء: ${failed}`,
      enable ? 0xDC2626 : 0x16A34A
    );

    return interaction.editReply(
      `${enable ? "تم تفعيل" : "تم إلغاء"} وضع القفل.\n` +
      `القنوات التي تمت معالجتها: ${changed}\n` +
      `القنوات التي تعذر تعديلها: ${failed}\n` +
      "ملاحظة: فتح القفل يعيد أذونات الإرسال إلى الوضع الافتراضي، وقد لا يعيد الأذونات المخصصة سابقًا."
    );
  }
});

// حماية السبام والمنشن الجماعي
client.on("messageCreate", async message => {
  if (!message.guild || message.author.bot) return;

  const config = getConfig(message.guild.id);
  if (!config.antiSpam) return;

  const member = message.member;
  if (isTrusted(member, config)) return;

  const now = Date.now();
  const key = `${message.guild.id}:${message.author.id}`;
  const history = (spamTracker.get(key) || [])
    .filter(time => now - time < 7000);

  history.push(now);
  spamTracker.set(key, history);

  const massMention =
    message.mentions.users.size >= 5 ||
    message.mentions.roles.size >= 4 ||
    message.mentions.everyone;

  const spam = history.length >= 6;

  if (!massMention && !spam) return;

  try {
    await message.delete().catch(() => {});

    if (member?.moderatable) {
      await member.timeout(
        60 * 1000,
        massMention ? "منشن جماعي" : "إرسال رسائل متكرر"
      );
    }

    spamTracker.delete(key);

    await logEvent(
      message.guild,
      "تم رصد سبام",
      `العضو: ${message.author.tag} (\`${message.author.id}\`)\n` +
      `السبب: ${massMention ? "منشن جماعي" : "تكرار الرسائل"}\n` +
      "الإجراء: حذف الرسالة ومحاولة إسكات العضو لمدة دقيقة.",
      0xDC2626
    );
  } catch (error) {
    console.error("خطأ حماية السبام:", error.message);
  }
});

// رصد دخول عدد كبير من الأعضاء
client.on("guildMemberAdd", async member => {
  const config = getConfig(member.guild.id);
  if (!config.antiRaid) return;

  const now = Date.now();
  const history = (raidTracker.get(member.guild.id) || [])
    .filter(time => now - time < 15000);

  history.push(now);
  raidTracker.set(member.guild.id, history);

  if (history.length >= 8) {
    await logEvent(
      member.guild,
      "تحذير غارة محتملة",
      `دخل ${history.length} أعضاء خلال 15 ثانية.\n` +
      "يرجى مراجعة الأعضاء الجدد وتفعيل القفل يدويًا عند الحاجة.",
      0xDC2626
    );

    raidTracker.set(member.guild.id, []);
  }
});

// رصد الحذف الإداري عبر سجل تدقيق Discord
async function monitorDestructiveAction(guild, targetId, actionType, label) {
  const config = getConfig(guild.id);
  if (!config.antiNuke) return;

  try {
    await new Promise(resolve => setTimeout(resolve, 1200));

    const logs = await guild.fetchAuditLogs({
      type: actionType,
      limit: 5
    });

    const entry = logs.entries.find(e =>
      e.target?.id === targetId &&
      Date.now() - e.createdTimestamp < 10000
    );

    if (!entry || !entry.executorId) return;

    const executor = await guild.members.fetch(entry.executorId)
      .catch(() => null);

    if (!executor || isTrusted(executor, config)) return;

    const now = Date.now();
    const key = `${guild.id}:${executor.id}`;
    const history = (actionTracker.get(key) || [])
      .filter(time => now - time < 10000);

    history.push(now);
    actionTracker.set(key, history);

    await logEvent(
      guild,
      "رصد تغيير إداري",
      `المنفذ: ${executor.user.tag} (\`${executor.id}\`)\n` +
      `الحدث: ${label}\n` +
      `التغييرات المرصودة خلال 10 ثوانٍ: ${history.length}`,
      0xF59E0B
    );

    if (history.length >= 3 && executor.kickable) {
      await executor.kick("Silfer Security: تغييرات إدارية متكررة");
      actionTracker.delete(key);

      await logEvent(
        guild,
        "تم طرد منفذ التغييرات",
        `العضو: ${executor.user.tag}\n` +
        "السبب: تنفيذ 3 تغييرات إدارية مراقبة خلال 10 ثوانٍ.",
        0xDC2626
      );
    }
  } catch (error) {
    console.error("تعذر فحص سجل التدقيق:", error.message);
  }
}

client.on("channelDelete", channel => {
  if (channel.guild) {
    monitorDestructiveAction(
      channel.guild,
      channel.id,
      12,
      `حذف قناة: ${channel.name}`
    );
  }
});

client.on("roleDelete", role => {
  monitorDestructiveAction(
    role.guild,
    role.id,
    32,
    `حذف رول: ${role.name}`
  );
});

client.on("guildBanAdd", ban => {
  monitorDestructiveAction(
    ban.guild,
    ban.user.id,
    22,
    `حظر عضو: ${ban.user.tag}`
  );
});

client.on("error", error => {
  console.error("Discord client error:", error);
});

process.on("unhandledRejection", error => {
  console.error("Unhandled rejection:", error);
});

client.login(TOKEN);
