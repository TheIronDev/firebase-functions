// The MIT License (MIT)
//
// Copyright (c) 2017 Firebase
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

import {
  BlockingFunction,
  CloudFunction,
  Event,
  EventContext,
  makeCloudFunction,
  optionsToEndpoint,
  optionsToTrigger,
} from '../cloud-functions';
import {
  AuthBlockingEventType,
  AuthEventContext,
  AuthUserRecord,
  BeforeCreateResponse,
  BeforeSignInResponse,
  HttpsError,
  UserInfo,
  UserRecord,
  userRecordConstructor,
  UserRecordMetadata,
  wrapHandler,
} from '../common/providers/identity';
import { DeploymentOptions } from '../function-configuration';

// TODO: yank in next breaking change release
export { UserRecord, UserInfo, UserRecordMetadata, userRecordConstructor };

export { HttpsError };

/** @hidden */
export const provider = 'google.firebase.auth';
/** @hidden */
export const service = 'firebaseauth.googleapis.com';

/** Resource level options */
export interface UserOptions {
  blockingOptions?: {
    idToken?: boolean;
    accessToken?: boolean;
    refreshToken?: boolean;
  };
}

/**
 * Handle events related to Firebase authentication users.
 */
export function user(userOptions?: UserOptions) {
  return _userWithOptions({}, userOptions || {});
}

/** @hidden */
export function _userWithOptions(
  options: DeploymentOptions,
  userOptions: UserOptions
) {
  return new UserBuilder(
    () => {
      if (!process.env.GCLOUD_PROJECT) {
        throw new Error('process.env.GCLOUD_PROJECT is not set.');
      }
      return 'projects/' + process.env.GCLOUD_PROJECT;
    },
    options,
    userOptions
  );
}

/** Builder used to create Cloud Functions for Firebase Auth user lifecycle events. */
export class UserBuilder {
  private static dataConstructor(raw: Event): UserRecord {
    return userRecordConstructor(raw.data);
  }

  /** @hidden */
  constructor(
    private triggerResource: () => string,
    private options: DeploymentOptions,
    private userOptions?: UserOptions
  ) {}

  /** Respond to the creation of a Firebase Auth user. */
  onCreate(
    handler: (user: UserRecord, context: EventContext) => PromiseLike<any> | any
  ): CloudFunction<UserRecord> {
    return this.onOperation(handler, 'user.create');
  }

  /** Respond to the deletion of a Firebase Auth user. */
  onDelete(
    handler: (user: UserRecord, context: EventContext) => PromiseLike<any> | any
  ): CloudFunction<UserRecord> {
    return this.onOperation(handler, 'user.delete');
  }

  beforeCreate(
    handler: (
      user: AuthUserRecord,
      context: AuthEventContext
    ) =>
      | BeforeCreateResponse
      | void
      | Promise<BeforeCreateResponse>
      | Promise<void>
  ): BlockingFunction {
    return this.beforeOperation(handler, 'beforeCreate');
  }

  beforeSignIn(
    handler: (
      user: AuthUserRecord,
      context: AuthEventContext
    ) =>
      | BeforeSignInResponse
      | void
      | Promise<BeforeSignInResponse>
      | Promise<void>
  ): BlockingFunction {
    return this.beforeOperation(handler, 'beforeSignIn');
  }

  private onOperation(
    handler: (
      user: UserRecord,
      context: EventContext
    ) => PromiseLike<any> | any,
    eventType: string
  ): CloudFunction<UserRecord> {
    return makeCloudFunction({
      handler,
      provider,
      eventType,
      service,
      triggerResource: this.triggerResource,
      dataConstructor: UserBuilder.dataConstructor,
      legacyEventType: `providers/firebase.auth/eventTypes/${eventType}`,
      options: this.options,
    });
  }

  private beforeOperation(
    handler: (
      user: AuthUserRecord,
      context: AuthEventContext
    ) =>
      | BeforeCreateResponse
      | BeforeSignInResponse
      | void
      | Promise<BeforeCreateResponse>
      | Promise<BeforeSignInResponse>
      | Promise<void>,
    eventType: AuthBlockingEventType
  ): BlockingFunction {
    const accessToken = this.userOptions?.blockingOptions?.accessToken || false;
    const idToken = this.userOptions?.blockingOptions?.idToken || false;
    const refreshToken =
      this.userOptions?.blockingOptions?.refreshToken || false;

    // Create our own function that just calls the provided function so we know for sure that
    // handler takes two arguments. This is something common/providers/identity depends on.
    const wrappedHandler = (user: AuthUserRecord, context: AuthEventContext) =>
      handler(user, context);
    const func: any = wrapHandler(eventType, wrappedHandler);

    const legacyEventType = `providers/cloud.auth/eventTypes/user.${eventType}`;

    func.__trigger = {
      labels: {},
      ...optionsToTrigger(this.options),
      blockingTrigger: {
        eventType: legacyEventType,
        options: {
          accessToken,
          idToken,
          refreshToken,
        },
      },
    };

    func.__endpoint = {
      platform: 'gcfv1',
      labels: {},
      ...optionsToEndpoint(this.options),
      blockingTrigger: {
        eventType: legacyEventType,
        options: {
          accessToken,
          idToken,
          refreshToken,
        },
      },
    };

    func.__requiredAPIs = [
      {
        api: 'identitytoolkit.googleapis.com',
        reason: 'Needed for auth blocking functions',
      },
    ];

    func.run = handler;

    return func;
  }
}
