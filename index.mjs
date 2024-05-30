import AWS from "aws-sdk";
import crypto from "crypto";
import axios from "axios";

// Function to compute SHA-256 hash
function getSHA256Hex(merchantTransactionId, privateApiKey) {
  const data = `${merchantTransactionId}_${privateApiKey}`;
  const hash = crypto.createHash("sha256").update(data).digest("hex");
  return hash;
}

async function getOrderId(merchantTransactionId) {
  try {
    const data = await fetchTBharatXTransactionData(
      "GET",
      `/merchant/transaction/${merchantTransactionId}`
    );
    const { transaction } = data;
    const { notes } = transaction;
    return notes.orderId;
  } catch (error) {
    console.log("🚀 error: Fetching transaction", error);
  }
}

export async function handler(event) {
  try {
    console.log("🔥  event", event);

    const { headers, body: _body } = event;
    const body = JSON.parse(_body);

    const { transaction } = body;
    const { id: merchantTransactionId, partnerId: merchantId } = transaction;

    const hashOfPrivateKeyAndTxnId = getSHA256Hex(
      merchantTransactionId,
      process.env.BHARATX_PRIVATE_API_KEY
    );
    const { "x-webhook-secret": webhookSecret } = headers;
    if (
      hashOfPrivateKeyAndTxnId !== webhookSecret &&
      merchantId !== process.env.BHARATX_PARTNER_ID
    ) {
      console.log("🚀 Error: Verification failed");
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: "Verification failed",
        }),
      };
    }

    const event_type = transaction.status;

    const bharatXQueue =
      "https://sqs.us-east-1.amazonaws.com/735902244362/paymentWebhookSqs";

    const sqs = new AWS.SQS({ region: "us-east-1" });

    console.log("🔥 header :>> ", headers);
    console.log("🔥 body :>> ", body);

    let orderId;

    //Modify Data accordingly
    let payload = {};

    console.log("🔥 event_type :>> ", event_type);

    switch (event_type) {
      case "SUCCESS":
        orderId = await getOrderId(merchantTransactionId);
        console.log("orderId", orderId);
        payload = {
          ...payload,
          event: "ORDER_CONFIRMED",
          orderId,
          transactionId: merchantTransactionId,
          paymentMethodType: "BHARATX",
        };
        break;

      // what about the order failed status

      default:
        break;
    }

    if (!payload.event) return null;

    const params = {
      QueueUrl: bharatXQueue,
      MessageBody: JSON.stringify({
        source: "bharatx",
        payload,
      }),
    };

    console.log("🔥 params :>> ", params);

    const sendMessageData = await sqs.sendMessage(params).promise();

    console.log("✅ sendMessageData :>>", sendMessageData);
  } catch (e) {
    console.log("🚀 ~ Error ", e);
  }
}

const fetchTBharatXTransactionData = async (
  method,
  endpoint,
  data = undefined,
  params = {}
) => {
  try {
    const clientId = process.env.BHARATX_PARTNER_ID;
    const clientSecret = process.env.BHARATX_PRIVATE_API_KEY;
    const authString = Buffer.from(`${clientId}:${clientSecret}`).toString(
      "base64"
    );
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Basic ${authString}`,
    };
    const api = axios.create({
      baseURL: process.env.BHARATX_BASE_URL,
      headers: headers,
    });
    const response = await api.request({
      method,
      url: endpoint,
      data,
      params,
    });
    if (response.status >= 200 && response.status < 300) {
      return response.data;
    }
  } catch (error) {
    console.log("🚀 error", error);
    throw new Error(`${error?.response?.data?.message || error.message}`);
  }
};
