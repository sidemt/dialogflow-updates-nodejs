// Copyright 2018, Google, Inc.
// Licensed under the Apache License, Version 2.0 (the 'License');
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an 'AS IS' BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
  * Best practices: Ask for daily updates and push notifications in a limited
  * capacity for optimal user experience. In a production-ready app, you should
  * be more sophisticated about this, i.e. re-ask after a certain period of time
  * or number of interactions.
  */

'use strict';

// ★Default Welcome intent のところから読むとたぶんわかりやすい★

// Actions on Google Client Library で提供される機能で使うものをインポート
// 参考: https://actions-on-google.github.io/actions-on-google-nodejs/2.12.0/index.html#conversational-services
const {
  dialogflow,
  BasicCard,
  Button,
  RegisterUpdate,
  Suggestions,
  UpdatePermission,
} = require('actions-on-google');
// Firebase Admin SDK をインポート
// 参考: https://firebase.google.com/docs/admin/setup?hl=ja
const admin = require('firebase-admin');
// Cloud Functions をインポート
// 参考: https://firebase.google.com/docs/functions/get-started?hl=ja
const functions = require('firebase-functions');

/** Dialogflow Parameters {@link https://dialogflow.com/docs/actions-and-parameters#parameters} */
const Parameters = {
  CATEGORY: 'category',
};

/** Collections and fields names in Firestore */
const FirestoreNames = {
  CATEGORY: 'category',
  CREATED_AT: 'created_at',
  INTENT: 'intent',
  TIP: 'tip',
  TIPS: 'tips',
  URL: 'url',
  USERS: 'users',
  USER_ID: 'userId',
};

/** App strings */
const RANDOM_CATEGORY = 'random';
const RECENT_TIP = 'most recent';
const TELL_LATEST_TIP_INTENT = 'tell_latest_tip';
const DAILY_NOTIFICATION_ASKED = 'daily_notification_asked';
const PUSH_NOTIFICATION_ASKED = 'push_notification_asked';

// Firebase Admin SDK の初期化
// 参考: https://firebase.google.com/docs/admin/setup?hl=ja#initialize_without_parameters
// > FIREBASE_CONFIG 環境変数は、Firebase CLI を介してデプロイされた Cloud Functions for Firebase の関数に自動的に組み込まれます。
admin.initializeApp();
const db = admin.firestore();
// Cloud Firestore のインスタンスを初期化
// 参考: https://firebase.google.com/docs/firestore/quickstart?hl=ja#initialize
const app = dialogflow({debug: true});

// Retrieve data from database and tell a tip.
// Dialogflow コンソールで、 tell_tip インテントには Training phrases が設定されている。
// Dialogflow コンソールの Entities に tip-category エンティティとしてカテゴリの種類が登録されている。
// Training phrases のマークされた部分に表示される @tip-category:category
// tip-category エンティティを パラメータ名 category に格納するという意味っぽい
app.intent('tell_tip', (conv, params) => {
  const category = params[Parameters.CATEGORY]; // パラメータ名categoryのパラメータを取得
  let tipsRef = db.collection(FirestoreNames.TIPS); // DBから tips コレクションを取得
  if (category !== RANDOM_CATEGORY) {
    // random以外なら、カテゴリが一致するデータのみを抽出
    tipsRef = tipsRef.where(FirestoreNames.CATEGORY, '==', category);
  }
  return tipsRef.get()
    .then((querySnapshot) => {
      const tips = querySnapshot.docs; // 上記の検索条件で取得されたレコード（ドキュメント）
      const tipIndex = Math.floor(Math.random() * tips.length); // レコード件数以内のランダムな数を生成
      const tip = tips[tipIndex]; // ランダムな数をindexに使って1件取得

      // conv.ask 参考: https://actions-on-google.github.io/actions-on-google-nodejs/classes/conversation.conversation-1.html#ask
      conv.ask(tip.get(FirestoreNames.TIP)); // 取得した1件のtipの"tip"フィールドの内容を発話
      conv.ask(new BasicCard({ // カードの表示
        text: tip.get(FirestoreNames.TIP), // "tip"フィールドの内容を表示
        buttons: new Button({
          title: 'Learn More!',
          url: tip.get(FirestoreNames.URL), // "url"フィールドの内容を表示
        }),
      }));

      if (!conv.user.storage[DAILY_NOTIFICATION_ASKED]) {
        conv.ask(new Suggestions('Send daily'));
        conv.user.storage[DAILY_NOTIFICATION_ASKED] = true;
      }
    });
});

// Retrieve data from database and tell a tip via push notification.
app.intent('tell_latest_tip', (conv) => {
  return db.collection(FirestoreNames.TIPS)
     // 並べ替え
    .orderBy(FirestoreNames.CREATED_AT, 'desc')
    .limit(1)
    .get()
    .then((querySnapshot) => {
      const tip = querySnapshot.docs[0];

      conv.ask(tip.get(FirestoreNames.TIP));
      conv.ask(new BasicCard({
        text: tip.get(FirestoreNames.TIP),
        buttons: new Button({
          title: 'Learn More!',
          url: tip.get(FirestoreNames.URL),
        }),
      }));

      // conv.user.storage で複数の会話をまたいでデータを保持できる。
      // 参考: https://developers.google.com/actions/assistant/save-data#save_data_across_conversations
      if (!conv.user.storage[PUSH_NOTIFICATION_ASKED]) {
        // まだPush Notificationについて訊いたことがなければこの処理を実行
        conv.ask(new Suggestions('Alert me of new tips')); // Suggestions を表示
        conv.user.storage[PUSH_NOTIFICATION_ASKED] = true; // PUSH_NOTIFICATION_ASKED を true にする(「訊いたことがある」にする)
      }
    });
});

// Dialogflow の画面(Dialogflow console)上で指定しなくても、ここで内容を設定できる。
// Default Welcome intent に対する処理。
// Dialogflow console では、Events に 「Welcome」 だけが設定されたintentが作成してある状態。
// 一番下のFulfillmentのEnable webhook call for this intent もONになっている。
app.intent('Default Welcome Intent', (conv) => {
  // Welcome intent が呼び出されたとき　★ここから読むとたぶんわかりやすい★

  // User engagement features aren't currently supported on speaker-only devices
  // See docs: https://developers.google.com/actions/assistant/updates/overview
  if (!conv.screen) {
    // 画面のないデバイスの場合
    return conv.close(`Hi! Welcome to Actions on Google Tips! To learn ` +
      `about user engagement you will need to switch to a screened device.`); // 終了
  }
  if (conv.user.verification !== 'VERIFIED') {
    // ゲストユーザーの場合: https://developers.google.com/actions/assistant/guest-users
    return conv.close('Hi! Welcome to Actions on Google Tips! To learn ' +
      `about user engagement you'll need to be a verified user.`); // 終了
  }

  // それ以外の場合
  // Get categories to show in the welcome message and in suggestions
  return db.collection(FirestoreNames.TIPS) // tips コレクションを返す
      /*
        (method) FirebaseFirestore.Query.get(): Promise<FirebaseFirestore.QuerySnapshot>
        Executes the query and returns the results as a QuerySnapshot.
        @return — A Promise that will be resolved with the results of the Query.
       */
      // queryを実行してQuerySnapshotを取得する(戻り値はPromise)
    .get()
      /*
        (method) Promise<FirebaseFirestore.QuerySnapshot>.then<void, never>(onfulfilled?: (value: FirebaseFirestore.QuerySnapshot) => void | PromiseLike<void>, onrejected?: (reason: any) => PromiseLike<never>): Promise<void>
        Attaches callbacks for the resolution and/or rejection of the Promise.
        @param onfulfilled — The callback to execute when the Promise is resolved.
        @param onrejected — The callback to execute when the Promise is rejected.
        @returns — A Promise for the completion of which ever callback is executed.
       */
      // .get() から返却されたPromiseに対して、resolveされたときの処理を定義？
    .then((querySnapshot) => {
      // ここが onfullfilled ?
      // create an array that contains only the unique values of categories
      const uniqueCategories = querySnapshot.docs.map((currentValue) => {
        // DBに登録されているカテゴリを取得
        return currentValue.get(FirestoreNames.CATEGORY);
      })
      .filter((element, index, array) => {
        return array.indexOf(element) === index;
      });
      uniqueCategories.unshift(RECENT_TIP); // DBに登録されているカテゴリ+RECENT_TIPを発話する
      const welcomeMessage = `Hi! Welcome to Actions on Google Tips! I can ` +
        `offer you tips for Actions on Google. You can pick a category ` +
        `from ${uniqueCategories.join(', ')}, or I can tell you a tip from ` +
        `a randomly selected category.`; // 発話するセリフの作成、格納
      uniqueCategories.push(RANDOM_CATEGORY); // SuggestionとしてはさらにRANDOM_CATEGORYを表示する
      conv.ask(welcomeMessage); // 発話
      conv.ask(new Suggestions(uniqueCategories)); // Suggestionの表示
    });
});

// setup_push intent に対する処理。 Dialogflow console では空のintentが作成してある状態。
// 一番下のFulfillment のみ、 Enable webhook call for this intent がONになっている。
// Start opt-in flow for push notifications
app.intent('setup_push', (conv) => {
  // Node.js client library の askForUpdatePermission function 
  // 参考: https://developers.google.com/actions/assistant/updates/notifications#opt-in_users
  conv.ask(new UpdatePermission({intent: TELL_LATEST_TIP_INTENT}));
});

// setup_push intent に対する処理 Dialogflow console ではEventsとAction and parametersが設定されたintentが作成してある。
// 一番下のFulfillment の Enable webhook call for this intent もONになっている。
// Save intent and user id if user gave consent.
app.intent('finish_push_setup', (conv, params) => {
  // 'PERMISSION'という名前の引数の値を取得
  // 参考: https://actions-on-google.github.io/actions-on-google-nodejs/classes/conversation_argument.arguments.html#get
  if (conv.arguments.get('PERMISSION')) {
    const userID = conv.arguments.get('UPDATES_USER_ID');
    return db.collection(FirestoreNames.USERS) // DBの users コレクション
      .add({ // DB にレコード（ドキュメント）を追加
        [FirestoreNames.INTENT]: TELL_LATEST_TIP_INTENT, // 許可したintent
        [FirestoreNames.USER_ID]: userID, // User id
      })
      .then((docRef) => {
        // onfulfilled で会話終了
        conv.close(`Ok, I'll start alerting you.`); // 終了
      });
  } else {
    // Permission が false
    conv.close(`Ok, I won't alert you.`); // 終了
  }
});

// Start opt-in flow for daily updates
app.intent('setup_update', (conv, params) => {
  const category = params[Parameters.CATEGORY];
  conv.ask(new RegisterUpdate({
    intent: 'tell_tip',
    arguments: [{name: Parameters.CATEGORY, textValue: category}],
    frequency: 'DAILY',
  }));
});

// Confirm outcome of opt-in for daily updates.
app.intent('finish_update_setup', (conv, params, registered) => {
  if (registered && registered.status === 'OK') {
     conv.close(`Ok, I'll start giving you daily updates.`);
   } else {
    conv.close(`Ok, I won't give you daily updates.`);
   }
});

// このexports.xxx で書いたものがFunction URL (xxx) として出力されてた気がする。
// firebase deploy した時に。
exports.aogTips = functions.https.onRequest(app);

/**
 * Everytime a tip is added to the Firestore DB, this function runs and sends
 * notifications to the subscribed users.
 **/
exports.createTip = functions.firestore
  .document(`${FirestoreNames.TIPS}/{tipId}`)
  .onCreate((snap, context) => {
    const request = require('request');
    const {google} = require('googleapis');
    const serviceAccount = require('./service-account.json');
    const jwtClient = new google.auth.JWT(
      serviceAccount.client_email, null, serviceAccount.private_key,
      ['https://www.googleapis.com/auth/actions.fulfillment.conversation'],
      null
    );
    let notification = {
      userNotification: {
        title: 'AoG tips latest tip',
      },
      target: {},
    };
    jwtClient.authorize((err, tokens) => {
      if (err) {
        throw new Error(`Auth error: ${err}`);
      }
      db.collection(FirestoreNames.USERS)
        .where(FirestoreNames.INTENT, '==', TELL_LATEST_TIP_INTENT)
        .get()
        .then((querySnapshot) => {
          querySnapshot.forEach((user) => {
            notification.target = {
              userId: user.get(FirestoreNames.USER_ID),
              intent: user.get(FirestoreNames.INTENT),
            };
            request.post('https://actions.googleapis.com/v2/conversations:send', {
              'auth': {
                'bearer': tokens.access_token,
              },
              'json': true,
              'body': {'customPushMessage': notification, 'isInSandbox': true},
            }, (err, httpResponse, body) => {
              if (err) {
                throw new Error(`API request error: ${err}`);
              }
              console.log(`${httpResponse.statusCode}: ` +
                `${httpResponse.statusMessage}`);
              console.log(JSON.stringify(body));
            });
          });
        })
        .catch((error) => {
          throw new Error(`Firestore query error: ${error}`);
        });
    });
    return 0;
  });

// DB の tips コレクション を元の状態に戻す（リセットする）Function URL
// Use this function to restore the content of the tips database.
exports.restoreTipsDB = functions.https.onRequest((request, response) => {
  db.collection(FirestoreNames.TIPS) // tips コレクションを削除
    .get()
    .then((querySnapshot) => {
      if (querySnapshot.size > 0) {
        let batch = db.batch();
        querySnapshot.forEach((doc) => {
          batch.delete(doc.ref); // 削除（の準備）
        });
        batch.commit() // DBに書き込む
          .then(addTips); // 削除が完了したらaddTipsを実行
      }
    })
    .catch((error) => {
      throw new Error(`Firestore query error: ${error}`);
    });
  // DBが元々空だったらaddTipsだけ実行
  addTips();

  /**
   * Add tips
   */
  function addTips() {
    const tips = require('./tipsDB.json'); // jsonファイルからtipsを読み込み
    let batch = db.batch();
    let tipsRef = db.collection(FirestoreNames.TIPS);
    tips.forEach((tip) => { // jsonファイルから読み込んだtips 1件1件に対して
      let tipRef = tipsRef.doc();
      batch.set(tipRef, tip); // DBに追加（の準備）
    });
    batch.commit() // DBに書き込む
      .then(() => {
        response.send(`Tips DB succesfully restored`); // 画面にこの文言が表示される（このテキストだけのResponseが返ってくる）
      })
      .catch((error) => {
        throw new Error(`Error restoring tips DB: ${error}`);
      });
  }
});
