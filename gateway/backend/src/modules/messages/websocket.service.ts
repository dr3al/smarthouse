import { AuthMessage } from 'src/types';
import { RawData, Server, WebSocket } from 'ws';
import { model } from '../infrastructure';

export class WebsocketService {
  private readonly server: Server<WebSocketCustomClient>;
  private deadSocketsCleanerInterval: NodeJS.Timer;

  private authRequestCB: AuthRequestCB;
  private authedMessageCB: AuthedMessageCB;
  private authedClientOfflineCB: OnlineStatusChangedCB;

  constructor(config: {
    port: number;
    authRequestCB: AuthRequestCB;
    authedMessageCB: AuthedMessageCB;
    authedClientOfflineCB: OnlineStatusChangedCB;
  }) {
    this.server = new Server({
      port: config.port,
    });

    this.authRequestCB = config.authRequestCB;
    // Здесь же в этом обработчике нужно написать функционал для трекинга, что вот устройство вышло в онлайн,
    // кто подписан на это событие, тем отправить уведомление, например веб сервер будет подписан на это событие
    this.authedMessageCB = config.authedMessageCB;
    this.authedClientOfflineCB =
      config.authedClientOfflineCB ||
      (async (client) => console.log(`Client ${client.uuid} disconnected`));
    this.handleConnections();
    this.startDeadSocketCleaning();
  }

  getOnlineClientUUIDs() {
    return [...this.server.clients]
      .filter(({ isAuthorized }) => isAuthorized)
      .map((connection) => connection.client.uuid);
  }

  async sendToClientBy(UUID: string, document: Record<string, any>) {
    let wasClientFound = false;
    for (const connection of this.server.clients) {
      if (connection.client.uuid === UUID) {
        await this.sendInto(connection, document);
        wasClientFound = true;
      }
    }
    if (!wasClientFound) throw new Error('Client does not connected to server');
  }

  sendToManyClientsBy(
    predicate: (client: model.Client) => boolean,
    getEncryptedMessagesForMatchedClient: (
      client: model.Client,
    ) => Promise<string[]>,
  ): void;
  sendToManyClientsBy(
    UUIDs: string[],
    getEncryptedMessagesForMatchedClient: (
      client: model.Client,
    ) => Promise<string[]>,
  ): void;
  async sendToManyClientsBy(
    UUIDsOrPredicate: string[] | ((client: model.Client) => boolean),
    getEncryptedMessagesForMatchedClient: (
      client: model.Client,
    ) => Promise<string[]>,
  ) {
    let predicate: (socket: WebSocketCustomClient) => boolean;

    if (typeof UUIDsOrPredicate == 'function') {
      predicate = ({ isAuthorized, client }) =>
        isAuthorized && UUIDsOrPredicate(client);
    } else {
      const uuids = new Set(UUIDsOrPredicate);
      predicate = (socket) =>
        socket.isAuthorized && uuids.has(socket.client.uuid);
    }

    for (const connection of this.server.clients) {
      if (predicate(connection)) {
        const encryptedMessages = await getEncryptedMessagesForMatchedClient(
          connection.client,
        );

        encryptedMessages.forEach((message) => connection.send(message));
      }
    }
  }

  private handleConnections() {
    this.server.on('connection', (socket) => {
      socket.isAlive = true;

      socket.on('pong', () => {
        socket.isAlive = true;
      });

      socket.once('message', async (message) => {
        try {
          await this.firstAuthMesssageHandler(socket, message);
        } catch (error: any) {
          console.log('first client message handler error', error, message);
          await this.sendInto(socket, { error: error.message });
          socket.close(1000);
        }
      });

      socket.on('close', () => {
        // TODO: проверить вызывается ли этот метод если мы teminate`нули девайс
        // надо ли вызывать обработчик authorizedClientDisconnectedHandler в двух местах?
        this.authedClientOfflineCB(socket.client);
      });
    });
  }

  private async sendInto(
    connection: WebSocketCustomClient,
    document: Record<string, any>,
  ) {
    return new Promise<void>((resolve, reject) => {
      connection.send(JSON.stringify(document), (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  private async firstAuthMesssageHandler(
    socket: WebSocketCustomClient,
    message: RawData,
  ) {
    const parsedMessage = JSON.parse(message.toString());
    console.log('firstAuthMesssageHandler parsedMessage: ', parsedMessage);

    const authorizationResult = await this.authRequestCB(parsedMessage);

    if (!authorizationResult.isAuthorized)
      throw new Error('Authorization: Crypto worker denied auth');

    socket.isAuthorized = true;
    socket.client = authorizationResult.client;

    socket.on('message', async (message: RawData) => {
      try {
        await this.authedMessageCB(message, socket.client);
      } catch (error: any) {
        console.log(
          `Authed message from client ${socket.client.uuid} error`,
          error,
          message,
        );
        await this.sendInto(socket, { error: error.message });
      }
    });
  }

  private startDeadSocketCleaning() {
    this.deadSocketsCleanerInterval = setInterval(() => {
      // Проверка на то, оставлять ли соединение активным
      this.server.clients.forEach((connection) => {
        // Если соединение мертво, завершить
        if (!connection.isAlive) {
          return connection.terminate();
        }
        // обьявить все соединения мертвыми, а тех кто откликнется на ping, сделать живыми
        connection.isAlive = false;
        connection.ping(null, false);
      });
    }, 10000); // TODO: move to config
  }
}

interface WebSocketCustomClient extends WebSocket {
  client: model.Client;
  isAuthorized: boolean;
  isAlive: boolean;
}

export interface AuthRequestCB {
  (parsedMessage: AuthMessage): Promise<AuthRequestResult> | AuthRequestResult;
}

export interface AuthedMessageCB {
  (rawEncryptedMessage: RawData, client: model.Client): Promise<any>;
}

export interface OnlineStatusChangedCB {
  (client: model.Client): Promise<any>;
}

export type AuthRequestResult =
  | { isAuthorized: false }
  | {
      isAuthorized: true;
      client: model.Client;
    };
