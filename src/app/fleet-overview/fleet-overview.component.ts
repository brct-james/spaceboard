import { Component } from '@angular/core';
import { ApiService } from '../api.service';
import { IntervalService } from '../interval.service';
import { SettingService } from '../setting.service';

@Component({
  selector: 'app-fleet-overview',
  templateUrl: './fleet-overview.component.html',
  styleUrls: ['./fleet-overview.component.sass']
})
export class FleetOverviewComponent {
  constructor(public api: ApiService, public intervals: IntervalService, private settings: SettingService) {}

  get timeRemainingGetFleetStatus() {
    if (this.intervals.timeRemainingTillCall['getFleetStatus'] === undefined) {
      return 0;
    }
    return Math.ceil(this.intervals.timeRemainingTillCall['getFleetStatus'].valueOf() / 1000);
  }

  get fleetArray() {
    let arr: object[] = this.api.retrieveLocally("fleet").ships;
    return arr;
  }

  ngOnInit(): void {
    this.intervals.new('getFleetStatus', this.updateFleetInfo.bind(this), this.settings.fleetUpdateInterval * 1000, this.settings.fleetUpdateToggle);
    this.updateFleetInfo();
  }

  async updateFleetInfo(): Promise<void> {
    await this.api.getAllShips();
  }
}
