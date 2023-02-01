import { Injectable } from '@angular/core';
import {
  AgentsService,
  ContractsService,
  DefaultService,
  FactionsService,
  FleetService,
  Register201ResponseData,
  RegisterRequest,
  System,
  SystemsService,
  Waypoint,
} from 'spacetraders-v2-ng';
import { LocalStorageService } from 'ngx-webstorage';
import { Router } from '@angular/router';
import { Clipboard } from '@angular/cdk/clipboard';
import { firstValueFrom, timeout } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';

@Injectable({
  providedIn: 'root',
})
export class ApiService {
  haveSession: boolean = false;
  DEBUG: boolean = true;

  constructor(
    private ls: LocalStorageService,
    private router: Router,
    private clipboard: Clipboard,
    private defaultService: DefaultService,
    private agentsService: AgentsService,
    private contractsService: ContractsService,
    private fleetService: FleetService,
    private systemsService: SystemsService
  ) {
    setInterval(this.handleInterval.bind(this), 5000);
    this.checkSessionStatus();
  }

  get lastUpdated(): number {
    let res = this.retrieveLocally('lastUpdated');
    return res === null ? Date.now() - 60000 : res;
  }

  set lastUpdated(newTimestamp: number) {
    this.storeLocally('lastUpdated', newTimestamp);
  }

  get lastArchived(): number {
    let res = this.retrieveLocally('lastArchived');
    return res === null ? Date.now() - 9000000 : res; //300000 * 30 = 9000000
  }

  set lastArchived(newTimestamp: number) {
    this.storeLocally('lastArchived', newTimestamp);
  }

  checkSessionStatus() {
    // this.clearLocally("userInfo");
    this.DEBUG &&
      console.log(
        '[api-service] Checking for cached credentials to resume session'
      );
    let localCredentials = this.retrieveLocally('userInfo');
    if (localCredentials) {
      //saved session, attempt login with same
      this.DEBUG &&
        console.log(
          '[api-service] Credentials found for:',
          localCredentials.username
        );
      this.login(localCredentials.userToken, true);
    } else {
      //no session saved, request user credentials
      //temporarily hardcoding these creds
      this.DEBUG &&
        console.log(
          '[api-service] No credentials found locally, requesting new credentials from user'
        );
      this.router.navigate(['/login']);
    }
  }

  mapOfFactionNameToEnum: Record<string, RegisterRequest.FactionEnum> = {
    Cosmic: RegisterRequest.FactionEnum.Cosmic,
    Void: RegisterRequest.FactionEnum.Void,
    Galactic: RegisterRequest.FactionEnum.Galactic,
    Quantum: RegisterRequest.FactionEnum.Quantum,
    Dominion: RegisterRequest.FactionEnum.Dominion,
    // Astro: RegisterRequest.FactionEnum.Astro,
    // Corsairs: RegisterRequest.FactionEnum.Corsairs,
    // United: RegisterRequest.FactionEnum.United,
    // Solitary: RegisterRequest.FactionEnum.Solitary,
    // Cobalt: RegisterRequest.FactionEnum.Cobalt,
  };

  async register(factionName: string, symbol: string): Promise<string> {
    symbol = symbol.toUpperCase();
    let faction: RegisterRequest.FactionEnum =
      this.mapOfFactionNameToEnum[factionName];
    this.DEBUG &&
      console.log(
        '[api-service] Attempting registration with:',
        symbol,
        '| faction:',
        faction
      );
    let registerRequest: RegisterRequest = {
      faction: faction,
      symbol: symbol,
    };
    return new Promise((resolve, reject) => {
      this.defaultService.register(registerRequest).subscribe((response) => {
        if (response != undefined) {
          let data = response.data;
          this.storeLocally('userInfo', {
            username: symbol,
            userToken: data.token,
          });
          this.storeLocally('agentInfo', {
            accountId: data.agent.accountId,
            credits: data.agent.credits,
            headquarters: data.agent.headquarters,
            symbol: data.agent.symbol,
          });
          this.storeLocally('contracts', {
            contracts: [data.contract],
          });
          this.storeLocally('fleet', {
            ships: [data.ship],
          });
          // this.clipboard.copy(data.token);
          this.haveSession = true;
          this.router.navigate(['/settings']);
          resolve(data.token);
        } else {
          reject('Response Undefined - Could not Parse Response');
        }
      });
    });
  }

  async login(token: string, skipRedirect = false): Promise<string> {
    let message: string;
    this.DEBUG &&
      console.log('[api-service] Attempting login with token:', token);
    this.agentsService.configuration.credentials['AgentToken'] = token;
    // TODO: see if the above works for setting credentials that getMyAgent request can use. Also write code for below to getMyAgent and other relevant entries
    let agentResolution = await new Promise((resolve, reject) => {
      this.agentsService.getMyAgent().subscribe((response) => {
        if (response != undefined) {
          let data = response.data;
          this.haveSession = true;
          this.storeLocally('userInfo', {
            username: data.symbol,
            userToken: token,
          });
          this.storeLocally('agentInfo', {
            accountId: data.accountId,
            credits: data.credits,
            headquarters: data.headquarters,
            symbol: data.symbol,
          });
          resolve(true);
        } else {
          reject('Response undefined');
        }
      });
    });

    let contractsResolution = await new Promise((resolve, reject) => {
      this.contractsService
        .getContracts(undefined, 100)
        .subscribe((response) => {
          if (response != undefined) {
            let data = response.data;
            this.storeLocally('contracts', {
              contracts: data,
            });
            resolve(true);
          } else {
            reject('Response undefined');
          }
        });
    });

    let fleetResolution = await this.getAllShips();

    if (agentResolution && contractsResolution && fleetResolution) {
      return new Promise((resolve, reject) => {
        if (!skipRedirect || this.router.url === '/login') {
          this.router.navigate(['/settings']);
        }
        // this.clipboard.copy(token);
        resolve(token);
      });
    }
    return new Promise((resolve, reject) => {
      reject;
    });
  }

  async getAccountInfo() {
    await new Promise((resolve, reject) => {
      this.agentsService.getMyAgent().subscribe((response) => {
        if (response != undefined) {
          let data = response.data;
          this.storeLocally('agentInfo', {
            accountId: data.accountId,
            credits: data.credits,
            headquarters: data.headquarters,
            symbol: data.symbol,
          });
          resolve(true);
        } else {
          reject('Response undefined');
        }
      });
    });
  }

  //   getAccountInfoAndPushNW() {
  //     this.api.getAccount().then((res: any) => {
  //       this.storeLocally('accountInfo', res.user);
  //       this.pushNetWorth(res.user.credits);
  //       this.DEBUG && console.log('[api-service] Got accountInfo and pushedNetWorth');
  //     });
  //   }

  async getAllShips(): Promise<string> {
    return await new Promise((resolve, reject) => {
      this.fleetService.getMyShips(undefined, 100).subscribe((response) => {
        if (response != undefined) {
          let data = response.data;
          this.storeLocally('fleet', {
            ships: data,
          });
          resolve('Success');
        } else {
          reject('Response undefined');
        }
      });
    });
  }

  async getAllSystems(): Promise<string> {
    console.log(
      '[api-service::getAllSystems] Received Request to getAllSystems'
    );
    return await new Promise(async (resolve, reject) => {
      let allSystems: Array<System> = [];
      let limit = 100;
      let page = 1;
      let count = 0;
      let total = 0;
      let response = await firstValueFrom(
        this.systemsService.getSystems(page, limit)
      );
      if (response != undefined) {
        count += limit;
        page += 1;
        total = response.meta.total;
        allSystems = response.data;
      } else {
        console.log('[api-service::getAllSystems] Failed to getSystems');
        reject('Failed to getSystems');
      }

      console.log(
        '[api-service::getAllSystems] Got page 1 up to limit 100:',
        allSystems
      );

      while (count < total) {
        try {
          response = await firstValueFrom(
            this.systemsService.getSystems(page, limit)
          );
        } catch (e) {
          if (e instanceof HttpErrorResponse && e.status == 429) {
            type RatelimitErrorResponse = {
              error: {
                message: string;
                code: number;
                data: {
                  type: string;
                  retryAfter: number;
                  limitBurst: number;
                  limitPerSecond: number;
                  remaining: number;
                  reset: string;
                };
              };
            };
            let rlErr: RatelimitErrorResponse = e.error;
            console.log(
              '[api-service::getAllSystems] Hit Ratelimit Response, Awaiting till retryAfter:',
              rlErr.error.data.retryAfter * 1000,
              'ms'
            );
            await new Promise((resolve) =>
              setTimeout(resolve, rlErr.error.data.retryAfter * 1000)
            );
            continue;
          }
        }
        if (response != undefined) {
          count += limit;
          page += 1;
          total = response.meta.total;
          allSystems.concat(response.data);
        } else {
          console.log(
            `[api-service::getAllSystems] Failed during getSystems batching: (page ${page}) (count ${count}) (total ${total}) (limit ${limit})`
          );
          reject(
            `Failed during getSystems batching: (page ${page}) (count ${count}) (total ${total}) (limit ${limit})`
          );
        }
      }

      this.storeLocally('systems', {
        systems: allSystems,
        timestamp: new Date().toISOString(),
      });

      resolve('');
    });
  }

  async getSystemWaypoints(systemSymbol: string): Promise<string> {
    return await new Promise((resolve, reject) => {
      this.systemsService
        .getSystemWaypoints(systemSymbol, undefined, 100)
        .subscribe((response) => {
          if (response != undefined) {
            let data = response.data;
            let waypointStorage: {
              systems: Record<string, Waypoint[]>;
              timestamp: string;
            } = this.retrieveLocally('waypoints') || {
              systems: {},
              timestamp: new Date(0).toISOString(),
            };
            waypointStorage['systems'][systemSymbol] = data;
            this.storeLocally('waypoints', waypointStorage);
            resolve('Success');
          } else {
            reject('Response undefined');
          }
        });
    });
  }

  //   getAndMergeFlightPlans(ships: any, callback: Function) {
  //     //Currently only gets OE system flight plans - will need to expand functionality later and either query for each flightId in ships arr or for each system...
  //     this.api.getFlightPlans('OE').then((res: any) => {
  //       // insert flightPlanObj
  //       res = res.flightPlans;
  //       let mergedArray = this.insertObjByKey(ships, res, 'flightPlanId', 'id');
  //       this.storeLocally('shipInfo', mergedArray);
  //       this.DEBUG && console.log('[api-service] Got all flight plan info, running callback');
  //       callback(mergedArray);
  //     });
  //   }

  //   // https://stackoverflow.com/questions/17880476/joins-in-javascript
  //   // Modified to insert flight plan object rather than left join contents of object
  //   insertObjByKey(objArr1: any[], objArr2: any[], key1: string, key2: string) {
  //     return objArr1.map((anObj1) => ({
  //       flightPlan: objArr2.find((anObj2) => anObj1[key1] === anObj2[key2]),
  //       ...anObj1,
  //     }));
  //   }

  //   pushNetWorth(newValue: number, timestamp?: number) {
  //     if (timestamp === undefined) {
  //       timestamp = Date.now().valueOf();
  //     }
  //     let netWorth = this.retrieveLocally('netWorthHistory');
  //     if (netWorth && netWorth.values.length > 0 && netWorth.values.length == netWorth.timestamps.length) {
  //       netWorth.values.push(newValue);
  //       netWorth.timestamps.push(timestamp);
  //     } else {
  //       netWorth = {
  //         values: [newValue],
  //         timestamps: [timestamp],
  //       };
  //     }
  //     this.storeLocally('netWorthHistory', netWorth);
  //     // this.clearLocally('netWorthHistory');
  //   }

  storeLocally(key: string, data: any) {
    this.DEBUG && console.log('[api-service] Storing:', key, data);
    this.ls.store(key, data);
  }

  retrieveLocally(key: string) {
    return JSON.parse(JSON.stringify(this.ls.retrieve(key)));
  }

  clearLocally(key: string) {
    return this.ls.clear(key);
  }

  clearAllLocalStorage(): void {
    this.ls.clear();
    window.location.reload();
  }

  handleInterval() {
    if (this.haveSession) {
      this.DEBUG && console.log('[api-service] Refresh check with session');
      let now = new Date();
      let nowMinutes = now.getMinutes();
      let nowValue = now.valueOf();
      // Check for update account info interval (60s: 60000)
      if (nowValue - this.lastUpdated >= 60000) {
        this.DEBUG &&
          console.log(
            '[api-service] Refresh interval reached, updating accountInfo.'
          );
        // this.getAccountInfo();
        this.lastUpdated = nowValue + 1;
      }
      // Check for archive new net worth data point (300s: 300000)
      let nmString = nowMinutes.toString();
      nmString = nmString[nmString.length - 1];
      if (
        nowValue - this.lastArchived >= 300000 &&
        (nmString == '5' || nmString == '0')
      ) {
        this.DEBUG &&
          console.log(
            '[api-service] Refresh interval reached, archiving net worth.'
          );
        let numMissed = Math.floor(
          (10000 + nowValue - this.lastArchived) / 300000
        );
        this.DEBUG &&
          console.log(
            '[api-service] Applying all archive intervals (missed + 1 current):',
            numMissed
          );
        for (let i = 1; i <= numMissed - 1; i++) {
          let cTime = this.lastArchived + i * 300000;
          // this.pushNetWorth(null, cTime);
        }
        // this.getAccountInfoAndPushNW();
        this.lastArchived = nowValue;
      }
    } else {
      this.DEBUG &&
        console.log('[api-service] Refresh check, no session found');
    }
  }
}
