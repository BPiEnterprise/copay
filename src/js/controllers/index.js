'use strict';

angular.module('copayApp.controllers').controller('indexController', function($rootScope, $scope, $log, $filter, $timeout, lodash, go, profileService, configService, isCordova, rateService, storageService, addressService, gettext, gettextCatalog, amMoment, nodeWebkit, addonManager, feeService, isChromeApp, bwsError, txFormatService, uxLanguage, $state, glideraService, isMobile, addressbookService, themeService, brand) {
  var self = this;
  var SOFT_CONFIRMATION_LIMIT = 12;
  self.isCordova = isCordova;
  self.isChromeApp = isChromeApp;
  self.isSafari = isMobile.Safari();
  self.onGoingProcess = {};
  self.historyShowLimit = 10;
  self.updatingTxHistory = {};
  self.brand = brand;

  var features = '';
  features += (brand.features.glidera.enabled ? 'Glidera,' : '');
  features += (brand.features.theme.themeDiscovery.enabled ? 'Theme Discovery,' : '');
  features += (brand.features.theme.skinDiscovery.enabled ? 'Skin Discovery,' : '');
  $log.debug('Application branding: ' + brand.shortName);
  $log.debug('Enabled features: ' + features.substring(0, features.length-1));

  function strip(number) {
    return (parseFloat(number.toPrecision(12)));
  };

  self.goHome = function() {
    go.walletHome();
  };

  self.menu = [{
    'title': gettext('Home'),
    'icon': 'icon-home',
    'link': 'walletHome'
  }, {
    'title': gettext('Receive'),
    'icon': 'icon-receive2',
    'link': 'receive'
  }, {
    'title': gettext('Send'),
    'icon': 'icon-paperplane',
    'link': 'send'
  }, {
    'title': gettext('History'),
    'icon': 'icon-history',
    'link': 'history'
  }];

  self.addonViews = addonManager.addonViews();
  self.menu = self.menu.concat(addonManager.addonMenuItems());
  self.menuItemSize = self.menu.length > 5 ? 2 : 3;
  self.txTemplateUrl = addonManager.txTemplateUrl() || 'views/includes/transaction.html';

  self.tab = 'walletHome';

  self.feeOpts = feeService.feeOpts;

  self.setOngoingProcess = function(processName, isOn) {
    $log.debug('onGoingProcess', processName, isOn);
    self[processName] = isOn;
    self.onGoingProcess[processName] = isOn;

    var name;
    self.anyOnGoingProcess = lodash.any(self.onGoingProcess, function(isOn, processName) {
      if (isOn)
        name = name || processName;
      return isOn;
    });
    // The first one
    self.onGoingProcessName = name;
    $timeout(function() {
      $rootScope.$apply();
    });
  };

  self.setFocusedWallet = function() {
    var fc = profileService.focusedClient;
    if (!fc) return;

    $log.debug('Set focus:', fc.credentials.walletId);

    // Clean status
    self.totalBalanceSat = null;
    self.lockedBalanceSat = null;
    self.availableBalanceSat = null;
    self.pendingAmount = null;
    self.spendUnconfirmed = null;

    self.totalBalanceStr = null;
    self.availableBalanceStr = null;
    self.lockedBalanceStr = null;

    self.alternativeBalanceAvailable = false;
    self.totalBalanceAlternative = null;

    self.currentFeeLevel = null;
    self.notAuthorized = false;
    self.txHistory = [];
    self.completeHistory = [];
    self.txProgress = 0;
    self.historyShowShowAll = false;
    self.balanceByAddress = null;
    self.pendingTxProposalsCountForUs = null;
    self.setSpendUnconfirmed();

    $timeout(function() {
      $rootScope.$apply();
      self.hasProfile = true;
      self.noFocusedWallet = false;
      self.onGoingProcess = {};

      // Credentials Shortcuts
      self.m = fc.credentials.m;
      self.n = fc.credentials.n;
      self.network = fc.credentials.network;
      self.copayerId = fc.credentials.copayerId;
      self.copayerName = fc.credentials.copayerName;
      self.requiresMultipleSignatures = fc.credentials.m > 1;
      self.isShared = fc.credentials.n > 1;
      self.walletName = fc.credentials.walletName;
      self.walletId = fc.credentials.walletId;
      self.isComplete = fc.isComplete();
      self.canSign = fc.canSign();
      self.isPrivKeyExternal = fc.isPrivKeyExternal();
      self.isPrivKeyEncrypted = fc.isPrivKeyEncrypted();
      self.externalSource = fc.getPrivKeyExternalSourceName();
      self.account = fc.credentials.account;

      if (self.externalSource == 'trezor')
        self.account++;

      self.txps = [];
      self.copayers = [];
      self.updateSkin();
      self.updateAlias();
      self.setAddressbook();

      self.initGlidera();

      self.setCustomBWSFlag();
      if (fc.isPrivKeyExternal()) {
        self.needsBackup = false;
        self.openWallet();
      } else {
        storageService.getBackupFlag(self.walletId, function(err, val) {
          self.needsBackup = self.network == 'testnet' ? false : !val;
          self.openWallet();
        });
      }

    });
  };

  self.setCustomBWSFlag = function() {
    var defaults = configService.getDefaults();
    var config = configService.getSync();

    self.usingCustomBWS = config.bwsFor &&  config.bwsFor[self.walletId] && (config.bwsFor[self.walletId] != defaults.bws.url);
  };

  self.setTab = function(tab, reset, tries, switchState) {
    tries = tries || 0;

    // check if the whole menu item passed
    if (typeof tab == 'object') {
      if (tab.open) {
        if (tab.link) {
          self.tab = tab.link;
        }
        tab.open();
        return;
      } else {
        return self.setTab(tab.link, reset, tries, switchState);
      }
    }
    if (self.tab === tab && !reset)
      return;

    if (!document.getElementById('menu-' + tab) && ++tries < 5) {
      return $timeout(function() {
        self.setTab(tab, reset, tries, switchState);
      }, 300);
    }

    if (!self.tab || !$state.is('walletHome'))
      self.tab = 'walletHome';

    var changeTab = function() {
      if (document.getElementById(self.tab)) {
        document.getElementById(self.tab).className = 'tab-out tab-view ' + self.tab;
        var old = document.getElementById('menu-' + self.tab);
        if (old) {
          old.className = '';
        }
      }

      if (document.getElementById(tab)) {
        document.getElementById(tab).className = 'tab-in  tab-view ' + tab;
        var newe = document.getElementById('menu-' + tab);
        if (newe) {
          newe.className = 'active';
        }
      }

      self.tab = tab;
      $rootScope.$emit('Local/TabChanged', tab);
    };

    if (switchState && !$state.is('walletHome')) {
      go.path('walletHome', function() {
        changeTab();
      });
      return;
    }

    changeTab();
  };


  self._updateRemotePreferencesFor = function(clients, prefs, cb) {
    var client = clients.shift();

    if (!client)
      return cb();

    $log.debug('Saving remote preferences', client.credentials.walletName, prefs);
    client.savePreferences(prefs, function(err) {
      // we ignore errors here
      if (err) $log.warn(err);

      self._updateRemotePreferencesFor(clients, prefs, cb);
    });
  };


  self.updateRemotePreferences = function(opts, cb) {
    var prefs = opts.preferences || {};
    var fc = profileService.focusedClient;

    // Update this JIC.
    var config = configService.getSync().wallet.settings;

    //prefs.email  (may come from arguments)
    prefs.language = self.defaultLanguageIsoCode;
    prefs.unit = config.unitCode;

    var clients = [];
    if (opts.saveAll) {
      clients = lodash.values(profileService.walletClients);
    } else {
      clients = [fc];
    };

    self._updateRemotePreferencesFor(clients, prefs, function(err) {
      if (err) return cb(err);
      if (!fc) return cb();

      fc.getPreferences(function(err, preferences) {
        if (err) {
          return cb(err);
        }
        self.preferences = preferences;
        return cb();
      });
    });
  };

  var _walletStatusHash = function(walletStatus) {
    var bal;
    if (walletStatus) {
      bal = walletStatus.balance.totalAmount;
    } else {
      bal = self.totalBalanceSat;
    }
    return bal;
  };

  self.updateAll = function(opts, initStatusHash, tries) {
    tries = tries || 0;
    opts = opts || {};

    if (opts.untilItChanges && lodash.isUndefined(initStatusHash)) {
      initStatusHash = _walletStatusHash();
      $log.debug('Updating status until it changes. initStatusHash:' + initStatusHash)
    }
    var get = function(cb) {
      if (opts.walletStatus)
        return cb(null, opts.walletStatus);
      else {
        self.updateError = false;
        return fc.getStatus({}, function(err, ret) {
          if (err) {
            self.updateError = bwsError.msg(err, gettext('Could not update Wallet'));
          } else {
            if (!opts.quiet)
              self.setOngoingProcess('scanning', ret.wallet.scanning);
          }
          return cb(err, ret);
        });
      }
    };

    var fc = profileService.focusedClient;
    if (!fc) return;

    $timeout(function() {

      if (!opts.quiet)
        self.setOngoingProcess('updatingStatus', true);

      $log.debug('Updating Status:', fc.credentials.walletName, tries);
      get(function(err, walletStatus) {
        var currentStatusHash = _walletStatusHash(walletStatus);
        $log.debug('Status update. hash:' + currentStatusHash + ' Try:' + tries);
        if (!err && opts.untilItChanges && initStatusHash == currentStatusHash && tries < 7) {
          return $timeout(function() {
            $log.debug('Retrying update... Try:' + tries)
            return self.updateAll({
              walletStatus: null,
              untilItChanges: true,
              triggerTxUpdate: opts.triggerTxUpdate,
            }, initStatusHash, ++tries);
          }, 1400 * tries);
        }
        if (!opts.quiet)
          self.setOngoingProcess('updatingStatus', false);

        if (err) {
          self.handleError(err);
          return;
        }
        $log.debug('Wallet Status:', walletStatus);
        self.setPendingTxps(walletStatus.pendingTxps);
        self.setFeesOpts();

        // Status Shortcuts
        self.walletName = walletStatus.wallet.name;
        self.walletSecret = walletStatus.wallet.secret;
        self.walletStatus = walletStatus.wallet.status;
        self.walletScanStatus = walletStatus.wallet.scanStatus;
        self.copayers = walletStatus.wallet.copayers;
        self.preferences = walletStatus.preferences;
        self.setBalance(walletStatus.balance);
        self.otherWallets = lodash.filter(profileService.getWallets(self.network), function(w) {
          return w.id != self.walletId;
        });

        // Notify external addons or plugins
        $rootScope.$emit('Local/BalanceUpdated', walletStatus.balance);

        $rootScope.$apply();

        if (opts.triggerTxUpdate) {
          $timeout(function() {
            self.updateTxHistory();
          }, 1);
        }
      });
    });
  };

  self.setSpendUnconfirmed = function() {
    self.spendUnconfirmed = configService.getSync().wallet.spendUnconfirmed;
  };

  self.setSendMax = function() {

    self.feeToSendMaxStr = null;
    self.feeRateToSendMax = null;

    // Set Send max
    if (self.currentFeeLevel && self.totalBytesToSendMax) {
      feeService.getCurrentFeeValue(self.currentFeeLevel, function(err, feePerKb) {

        // KB to send max
        var feeToSendMaxSat = parseInt(((self.totalBytesToSendMax * feePerKb) / 1000.).toFixed(0));
        self.feeRateToSendMax = feePerKb;

        if (self.availableBalanceSat > feeToSendMaxSat) {
          self.availableMaxBalance = strip((self.availableBalanceSat - feeToSendMaxSat) * self.satToUnit);
          self.feeToSendMaxStr = profileService.formatAmount(feeToSendMaxSat) + ' ' + self.unitName;
        }
      });
    }

  };

  self.setCurrentFeeLevel = function(level) {
    self.currentFeeLevel = level || configService.getSync().wallet.settings.feeLevel || 'normal';
    self.setSendMax();
  };


  self.setFeesOpts = function() {
    var fc = profileService.focusedClient;
    if (!fc) return;
    $timeout(function() {
      feeService.getFeeLevels(function(levels) {
        self.feeLevels = levels;
        $rootScope.$apply();
      });
    });
  };

  self.updateBalance = function() {
    var fc = profileService.focusedClient;
    $timeout(function() {
      self.setOngoingProcess('updatingBalance', true);
      $log.debug('Updating Balance');
      fc.getBalance(function(err, balance) {
        self.setOngoingProcess('updatingBalance', false);
        if (err) {
          self.handleError(err);
          return;
        }
        $log.debug('Wallet Balance:', balance);
        self.setBalance(balance);
      });
    });
  };

  self.updatePendingTxps = function() {
    var fc = profileService.focusedClient;
    $timeout(function() {
      self.setOngoingProcess('updatingPendingTxps', true);
      $log.debug('Updating PendingTxps');
      fc.getTxProposals({}, function(err, txps) {
        self.setOngoingProcess('updatingPendingTxps', false);
        if (err) {
          self.handleError(err);
        } else {
          $log.debug('Wallet PendingTxps:', txps);
          self.setPendingTxps(txps);
        }
        $rootScope.$apply();
      });
    });
  };

  // This handles errors from BWS/index with are nomally
  // trigger from async events (like updates)
  self.handleError = function(err) {
    $log.warn('Client ERROR:', err);
    if (err.code === 'NOT_AUTHORIZED') {
      self.notAuthorized = true;
      go.walletHome();
    } else if (err.code === 'NOT_FOUND') {
      self.showErrorPopup(gettext('Could not access Wallet Service: Not found'));
    } else {
      var msg = ""
      $scope.$emit('Local/ClientError', (err.error ? err.error : err));
      var msg = bwsError.msg(err, gettext('Error at Wallet Service'));
      self.showErrorPopup(msg);
    }
  };
  self.openWallet = function() {
    var fc = profileService.focusedClient;
    $timeout(function() {
      $rootScope.$apply();
      self.setOngoingProcess('openingWallet', true);
      self.updateError = false;
      fc.openWallet(function(err, walletStatus) {
        self.setOngoingProcess('openingWallet', false);
        if (err) {
          self.updateError = true;
          self.handleError(err);
          return;
        }
        $log.debug('Wallet Opened');
        self.updateAll(lodash.isObject(walletStatus) ? {
          walletStatus: walletStatus
        } : null);
        $rootScope.$apply();
      });
    });
  };

  self.setPendingTxps = function(txps) {
    self.pendingTxProposalsCountForUs = 0;
    var now = Math.floor(Date.now() / 1000);

    lodash.each(txps, function(tx) {

      tx = txFormatService.processTx(tx);

      // no future transactions...
      if (tx.createdOn > now)
        tx.createdOn = now;

      var action = lodash.find(tx.actions, {
        copayerId: self.copayerId
      });

      if (!action && tx.status == 'pending') {
        tx.pendingForUs = true;
      }

      if (action && action.type == 'accept') {
        tx.statusForUs = 'accepted';
      } else if (action && action.type == 'reject') {
        tx.statusForUs = 'rejected';
      } else {
        tx.statusForUs = 'pending';
      }

      if (!tx.deleteLockTime)
        tx.canBeRemoved = true;

      if (tx.creatorId != self.copayerId) {
        self.pendingTxProposalsCountForUs = self.pendingTxProposalsCountForUs + 1;
      }
      addonManager.formatPendingTxp(tx);
    });
    self.txps = txps;
  };

  var SAFE_CONFIRMATIONS = 6;

  self.processNewTxs = function(txs) {
    var config = configService.getSync().wallet.settings;
    var now = Math.floor(Date.now() / 1000);
    var txHistoryUnique = {};
    var ret = [];
    self.hasUnsafeConfirmed = false;

    lodash.each(txs, function(tx) {
      tx = txFormatService.processTx(tx);

      // no future transactions...
      if (tx.time > now)
        tx.time = now;

      if (tx.confirmations >= SAFE_CONFIRMATIONS) {
        tx.safeConfirmed = SAFE_CONFIRMATIONS + '+';
      } else {
        tx.safeConfirmed = false;
        self.hasUnsafeConfirmed = true;
      }

      if (!txHistoryUnique[tx.txid]) {
        ret.push(tx);
        txHistoryUnique[tx.txid] = true;
      } else {
        $log.debug('Ignoring duplicate TX in history: ' + tx.txid)
      }
    });

    return ret;
  };

  self.updateAlias = function() {
    var config = configService.getSync();
    config.aliasFor = config.aliasFor || {};
    self.alias = config.aliasFor[self.walletId];
    var fc = profileService.focusedClient;
    fc.alias = self.alias;
  };

  self.updateSkin = function() {
    themeService.updateSkin(self.walletId);
  };

  self.setBalance = function(balance) {
    if (!balance) return;
    var config = configService.getSync().wallet.settings;
    var COIN = 1e8;

    // Address with Balance
    self.balanceByAddress = balance.byAddress;

    // SAT
    if (self.spendUnconfirmed) {
      self.totalBalanceSat = balance.totalAmount;
      self.lockedBalanceSat = balance.lockedAmount;
      self.availableBalanceSat = balance.availableAmount;
      self.pendingAmount = null;
    } else {
      self.totalBalanceSat = balance.totalConfirmedAmount;
      self.lockedBalanceSat = balance.lockedConfirmedAmount;
      self.availableBalanceSat = balance.availableConfirmedAmount;
      self.pendingAmount = balance.totalAmount - balance.totalConfirmedAmount;
    }

    // Selected unit
    self.unitToSatoshi = config.unitToSatoshi;
    self.satToUnit = 1 / self.unitToSatoshi;
    self.unitName = config.unitName;

    //STR
    self.totalBalanceStr = profileService.formatAmount(self.totalBalanceSat) + ' ' + self.unitName;
    self.lockedBalanceStr = profileService.formatAmount(self.lockedBalanceSat) + ' ' + self.unitName;
    self.availableBalanceStr = profileService.formatAmount(self.availableBalanceSat) + ' ' + self.unitName;

    if (self.pendingAmount) {
      self.pendingAmountStr = profileService.formatAmount(self.pendingAmount) + ' ' + self.unitName;
    } else {
      self.pendingAmountStr = null;
    }

    self.alternativeName = config.alternativeName;
    self.alternativeIsoCode = config.alternativeIsoCode;

    // Other
    self.totalBytesToSendMax = balance.totalBytesToSendMax;
    self.setCurrentFeeLevel();

    // Check address
    addressService.isUsed(self.walletId, balance.byAddress, function(err, used) {
      if (used) {
        $log.debug('Address used. Creating new');
        $rootScope.$emit('Local/NeedNewAddress');
      }
    });

    rateService.whenAvailable(function() {

      var totalBalanceAlternative = rateService.toFiat(self.totalBalanceSat, self.alternativeIsoCode);
      var lockedBalanceAlternative = rateService.toFiat(self.lockedBalanceSat, self.alternativeIsoCode);
      var alternativeConversionRate = rateService.toFiat(100000000, self.alternativeIsoCode);

      self.totalBalanceAlternative = $filter('noFractionNumber')(totalBalanceAlternative, 2);
      self.lockedBalanceAlternative = $filter('noFractionNumber')(lockedBalanceAlternative, 2);
      self.alternativeConversionRate = $filter('noFractionNumber')(alternativeConversionRate, 2);

      self.alternativeBalanceAvailable = true;
      self.updatingBalance = false;

      self.isRateAvailable = true;
      $rootScope.$apply();
    });

    if (!rateService.isAvailable()) {
      $rootScope.$apply();
    }
  };

  this.csvHistory = function() {

    function saveFile(name, data) {
      var chooser = document.querySelector(name);
      chooser.addEventListener("change", function(evt) {
        var fs = require('fs');
        fs.writeFile(this.value, data, function(err) {
          if (err) {
            $log.debug(err);
          }
        });
      }, false);
      chooser.click();
    }

    function formatDate(date) {
      var dateObj = new Date(date);
      if (!dateObj) {
        $log.debug('Error formating a date');
        return 'DateError'
      }
      if (!dateObj.toJSON()) {
        return '';
      }

      return dateObj.toJSON();
    }

    function formatString(str) {
      if (!str) return '';

      if (str.indexOf('"') !== -1) {
        //replace all
        str = str.replace(new RegExp('"', 'g'), '\'');
      }

      //escaping commas
      str = '\"' + str + '\"';

      return str;
    }

    var step = 6;
    var unique = {};

    function getHistory(cb) {
      storageService.getTxHistory(c.walletId, function(err, txs) {
        if (err) return cb(err);

        var txsFromLocal = [];
        try {
          txsFromLocal = JSON.parse(txs);
        } catch (ex) {
          $log.warn(ex);
        }

        allTxs.push(txsFromLocal);
        return cb(null, lodash.flatten(allTxs));
      });
    }

    if (isCordova) {
      $log.info('CSV generation not available in mobile');
      return;
    }
    var isNode = nodeWebkit.isDefined();
    var fc = profileService.focusedClient;
    var c = fc.credentials;
    if (!fc.isComplete()) return;
    var self = this;
    var allTxs = [];

    $log.debug('Generating CSV from History');
    self.setOngoingProcess('generatingCSV', true);

    $timeout(function() {
      getHistory(function(err, txs) {
        self.setOngoingProcess('generatingCSV', false);
        if (err) {
          self.handleError(err);
        } else {
          $log.debug('Wallet Transaction History:', txs);

          self.satToUnit = 1 / self.unitToSatoshi;
          var data = txs;
          var satToBtc = 1 / 100000000;
          var filename = 'Copay-' + (self.alias || self.walletName) + '.csv';
          var csvContent = '';

          if (!isNode) csvContent = 'data:text/csv;charset=utf-8,';
          csvContent += 'Date,Destination,Note,Amount,Currency,Spot Value,Total Value,Tax Type,Category\n';

          var _amount, _note;
          var dataString;
          data.forEach(function(it, index) {
            var amount = it.amount;

            if (it.action == 'moved')
              amount = 0;

            _amount = (it.action == 'sent' ? '-' : '') + (amount * satToBtc).toFixed(8);
            _note = formatString((it.message ? it.message : '') + ' TxId: ' + it.txid + ' Fee:' + (it.fees * satToBtc).toFixed(8));

            if (it.action == 'moved')
              _note += ' Moved:' + (it.amount * satToBtc).toFixed(8)

            dataString = formatDate(it.time * 1000) + ',' + formatString(it.addressTo) + ',' + _note + ',' + _amount + ',BTC,,,,';
            csvContent += dataString + "\n";

            if (it.fees && (it.action == 'moved' || it.action == 'sent')) {
              var _fee = (it.fees * satToBtc).toFixed(8)
              csvContent += formatDate(it.time * 1000) + ',Bitcoin Network Fees,, -' + _fee + ',BTC,,,,' + "\n";
            }
          });

          if (isNode) {
            saveFile('#export_file', csvContent);
          } else {
            var encodedUri = encodeURI(csvContent);
            var link = document.createElement("a");
            link.setAttribute("href", encodedUri);
            link.setAttribute("download", filename);
            link.click();
          }
        }
        $rootScope.$apply();
      });
    });
  };

  self.removeSoftConfirmedTx = function(txs) {
    return lodash.map(txs, function(tx) {
      if (tx.confirmations >= SOFT_CONFIRMATION_LIMIT)
        return tx;
    });
  }

  self.getConfirmedTxs = function(walletId, cb) {

    storageService.getTxHistory(walletId, function(err, txs) {
      if (err) return cb(err);

      var localTxs = [];

      if (!txs) {
        return cb(null, localTxs);
      }

      try {
        localTxs = JSON.parse(txs);
      } catch (ex) {
        $log.warn(ex);
      }
      return cb(null, lodash.compact(self.removeSoftConfirmedTx(localTxs)));
    });
  }

  self.updateLocalTxHistory = function(client, cb) {
    var requestLimit = 6;
    var walletId = client.credentials.walletId;

    self.getConfirmedTxs(walletId, function(err, txsFromLocal) {
      if (err) return cb(err);
      var endingTxid = txsFromLocal[0] ? txsFromLocal[0].txid : null;

      function getNewTxs(newTxs, skip, i_cb) {

        self.getTxsFromServer(client, skip, endingTxid, requestLimit, function(err, res, shouldContinue) {
          if (err) return i_cb(err);

          newTxs = newTxs.concat(lodash.compact(res));
          skip = skip + requestLimit;

          $log.debug('Syncing TXs. Got:' + newTxs.length + ' Skip:' + skip, ' EndingTxid:', endingTxid, ' Continue:', shouldContinue);

          if (!shouldContinue) {
            newTxs = self.processNewTxs(newTxs);
            $log.debug('Finish Sync: New Txs: ' + newTxs.length);
            return i_cb(null, newTxs);
          }

          if (walletId ==  profileService.focusedClient.credentials.walletId) 
            self.txProgress = newTxs.length;

          $timeout(function() {
            $rootScope.$apply();
          });
          getNewTxs(newTxs, skip, i_cb);
        });
      };

      getNewTxs([], 0, function(err, txs) {
        if (err) return cb(err);
        var newHistory = lodash.compact(txs.concat(txsFromLocal));
        $log.debug('Tx History synced. Total Txs: ' + newHistory.length);

        if (walletId ==  profileService.focusedClient.credentials.walletId) {
          self.completeHistory = newHistory;
          self.txHistory = newHistory.slice(0, self.historyShowLimit);
          self.historyShowShowAll = newHistory.length >= self.historyShowLimit;
        }

        return storageService.setTxHistory(JSON.stringify(newHistory), walletId, function() {
          return cb();
        });
      });
    });
  }
  self.showAllHistory = function() {
    self.historyShowShowAll = false;
    self.historyRendering = true;
    $timeout(function() {
      $rootScope.$apply();
      $timeout(function() {
        self.historyRendering = false;
        self.txHistory = self.completeHistory;
      }, 100);
    }, 100);
  };

  self.getTxsFromServer = function(client, skip, endingTxid, limit, cb) {
    var res = [];

    client.getTxHistory({
      skip: skip,
      limit: limit
    }, function(err, txsFromServer) {
      if (err) return cb(err);

      if (!txsFromServer.length)
        return cb();

      var res = lodash.takeWhile(txsFromServer, function(tx) {
        return tx.txid != endingTxid;
      });

      return cb(null, res, res.length == limit);
    });
  };

  self.updateHistory = function() {
    var fc = profileService.focusedClient;
    if (!fc) return;
    var walletId = fc.credentials.walletId;

    if (!fc.isComplete() || self.updatingTxHistory[walletId]) return;

    $log.debug('Updating Transaction History');
    self.txHistoryError = false;
    self.updatingTxHistory[walletId] = true;

    $timeout(function() {
      self.updateLocalTxHistory(fc, function(err) {
        self.updatingTxHistory[walletId] = false;
        if (err)
          self.txHistoryError = true;

        $rootScope.$apply();
      });
    });
  };

  self.updateTxHistory = lodash.debounce(function() {
    self.updateHistory();
  }, 1000);

  self.throttledUpdateHistory = lodash.throttle(function() {
    self.updateHistory();
  }, 5000);

  self.showErrorPopup = function(msg, cb) {
    $log.warn('Showing err popup:' + msg);
    self.showAlert = {
      msg: msg,
      close: function(err) {
        self.showAlert = null;
        if (cb) return cb(err);
      },
    };
    $timeout(function() {
      $rootScope.$apply();
    });
  };

  self.recreate = function(cb) {
    var fc = profileService.focusedClient;
    self.setOngoingProcess('recreating', true);
    fc.recreateWallet(function(err) {
      self.notAuthorized = false;
      self.setOngoingProcess('recreating', false);

      if (err) {
        self.handleError(err);
        $rootScope.$apply();
        return;
      }

      profileService.setWalletClients();
      $timeout(function() {
        $rootScope.$emit('Local/WalletImported', self.walletId);
      }, 100);
    });
  };

  self.openMenu = function() {
    go.swipe(true);
  };

  self.closeMenu = function() {
    go.swipe();
  };

  self.retryScan = function() {
    var self = this;
    self.startScan(self.walletId);
  }

  self.startScan = function(walletId) {
    $log.debug('Scanning wallet ' + walletId);
    var c = profileService.walletClients[walletId];
    if (!c.isComplete()) return;

    if (self.walletId == walletId)
      self.setOngoingProcess('scanning', true);

    c.startScan({
      includeCopayerBranches: true,
    }, function(err) {
      if (err && self.walletId == walletId) {
        self.setOngoingProcess('scanning', false);
        self.handleError(err);
        $rootScope.$apply();
      }
    });
  };

  self.setUxLanguage = function() {
    var userLang = uxLanguage.update();
    self.defaultLanguageIsoCode = userLang;
    self.defaultLanguageName = uxLanguage.getName(userLang);
  };

  self.initGlidera = function(accessToken) {
    self.glideraVisible = configService.getSync().glidera.visible;
    self.glideraTestnet = configService.getSync().glidera.testnet;
    var network = self.glideraTestnet ? 'testnet' : 'livenet';

    self.glideraToken = null;
    self.glideraError = null;
    self.glideraPermissions = null;
    self.glideraEmail = null;
    self.glideraPersonalInfo = null;
    self.glideraTxs = null;
    self.glideraStatus = null;

    if (!self.glideraVisible) return;

    glideraService.setCredentials(network);

    var getToken = function(cb) {
      if (accessToken) {
        cb(null, accessToken);
      } else {
        storageService.getGlideraToken(network, cb);
      }
    };

    getToken(function(err, accessToken) {
      if (err || !accessToken) return;
      else {
        self.glideraLoading = 'Connecting to Glidera...';
        glideraService.getAccessTokenPermissions(accessToken, function(err, p) {
          self.glideraLoading = null;
          if (err) {
            self.glideraError = err;
          } else {
            self.glideraToken = accessToken;
            self.glideraPermissions = p;
            self.updateGlidera({
              fullUpdate: true
            });
          }
        });
      }
    });
  };

  self.updateGlidera = function(opts) {
    if (!self.glideraToken || !self.glideraPermissions) return;
    var accessToken = self.glideraToken;
    var permissions = self.glideraPermissions;

    opts = opts || {};

    glideraService.getStatus(accessToken, function(err, data) {
      self.glideraStatus = data;
    });

    glideraService.getLimits(accessToken, function(err, limits) {
      self.glideraLimits = limits;
    });

    if (permissions.transaction_history) {
      self.glideraLoadingHistory = 'Getting Glidera transactions...';
      glideraService.getTransactions(accessToken, function(err, data) {
        self.glideraLoadingHistory = null;
        self.glideraTxs = data;
      });
    }

    if (permissions.view_email_address && opts.fullUpdate) {
      self.glideraLoadingEmail = 'Getting Glidera Email...';
      glideraService.getEmail(accessToken, function(err, data) {
        self.glideraLoadingEmail = null;
        self.glideraEmail = data.email;
      });
    }
    if (permissions.personal_info && opts.fullUpdate) {
      self.glideraLoadingPersonalInfo = 'Getting Glidera Personal Information...';
      glideraService.getPersonalInfo(accessToken, function(err, data) {
        self.glideraLoadingPersonalInfo = null;
        self.glideraPersonalInfo = data;
      });
    }

  };

  self.setAddressbook = function(ab) {
    if (ab) {
      self.addressbook = ab;
      return;
    }

    addressbookService.list(function(err, ab) {
      if (err) {
        $log.error('Error getting the addressbook');
        return;
      }
      self.addressbook = ab;
    });
  };

  $rootScope.$on('Local/ClearHistory', function(event) {
    $log.debug('The wallet transaction history has been deleted');
    self.txHistory = self.completeHistory = [];
    self.updateHistory();
  });

  $rootScope.$on('Local/AddressbookUpdated', function(event, ab) {
    self.setAddressbook(ab);
  });

  // UX event handlers

  $rootScope.$on('Local/AliasUpdated', function(event) {
    self.updateAlias();
    $timeout(function() {
      $rootScope.$apply();
    });
  });

  $rootScope.$on('Local/SpendUnconfirmedUpdated', function(event) {
    self.setSpendUnconfirmed();
    self.updateAll();
  });

  $rootScope.$on('Local/FeeLevelUpdated', function(event, level) {
    self.setCurrentFeeLevel(level);
  });

  $rootScope.$on('Local/ProfileBound', function() {
    storageService.getRemotePrefsStoredFlag(function(err, val) {
      if (err || val) return;
      self.updateRemotePreferences({
        saveAll: true
      }, function() {
        $log.debug('Remote preferences saved')
        storageService.setRemotePrefsStoredFlag(function() {});
      });
    });
  });

  $rootScope.$on('Local/NewFocusedWallet', function() {
    self.setUxLanguage();
  });

  $rootScope.$on('Local/LanguageSettingUpdated', function() {
    self.setUxLanguage();
    self.updateRemotePreferences({
      saveAll: true
    }, function() {
      $log.debug('Remote preferences saved')
    });
  });

  $rootScope.$on('Local/GlideraUpdated', function(event, accessToken) {
    self.initGlidera(accessToken);
  });

  $rootScope.$on('Local/GlideraTx', function(event, accessToken, permissions) {
    self.updateGlidera();
  });

  $rootScope.$on('Local/GlideraError', function(event) {
    self.debouncedUpdate();
  });

  $rootScope.$on('Local/UnitSettingUpdated', function(event) {
    self.updateAll();
    self.updateTxHistory();
    self.updateRemotePreferences({
      saveAll: true
    }, function() {
      $log.debug('Remote preferences saved')
    });
  });

  $rootScope.$on('Local/EmailSettingUpdated', function(event, email, cb) {
    self.updateRemotePreferences({
      preferences: {
        email: email || null
      },
    }, cb);
  });

  $rootScope.$on('Local/WalletCompleted', function(event) {
    self.setFocusedWallet();
    go.walletHome();
  });

  self.debouncedUpdate = lodash.throttle(function() {
    self.updateAll({
      quiet: true
    });
    self.updateTxHistory();
  }, 4000, {
    leading: false,
    trailing: true
  });

  $rootScope.$on('Local/Resume', function(event) {
    $log.debug('### Resume event');
    self.debouncedUpdate();
  });

  $rootScope.$on('Local/BackupDone', function(event) {
    self.needsBackup = false;
    $log.debug('Backup done');
    storageService.setBackupFlag(self.walletId, function(err) {
      $log.debug('Backup done stored');
    });
  });

  $rootScope.$on('Local/DeviceError', function(event, err) {
    self.showErrorPopup(err, function() {
      if (self.isCordova && navigator && navigator.app) {
        navigator.app.exitApp();
      }
    });
  });

  $rootScope.$on('Local/WalletImported', function(event, walletId) {
    self.needsBackup = false;
    storageService.setBackupFlag(walletId, function() {
      $log.debug('Backup done stored');
      addressService.expireAddress(walletId, function(err) {
        $timeout(function() {
          self.txHistory = self.completeHistory = [];
          storageService.removeTxHistory(walletId, function() {
            self.startScan(walletId);
          });
        }, 500);
      });
    });
  });

  $rootScope.$on('NewIncomingTx', function() {
    self.updateAll({
      walletStatus: null,
      untilItChanges: true,
      triggerTxUpdate: true,
    });
  });


  $rootScope.$on('NewBlock', function() {
    if (self.glideraVisible) {
      $timeout(function() {
        self.updateGlidera();
      });
    }
    if (self.pendingAmount) {
      self.updateAll({
        walletStatus: null,
        untilItChanges: null,
        triggerTxUpdate: true,
      });
    } else if (self.hasUnsafeConfirmed) {
      $log.debug('Wallet has transactions with few confirmations. Updating.')
      if (self.network == 'testnet') {
        self.throttledUpdateHistory();
      } else {
        self.updateTxHistory();
      }
    }
  });


  $rootScope.$on('NewOutgoingTx', function() {
    self.updateAll({
      walletStatus: null,
      untilItChanges: true,
      triggerTxUpdate: true,
    });
  });

  lodash.each(['NewTxProposal', 'TxProposalFinallyRejected', 'TxProposalRemoved', 'NewOutgoingTxByThirdParty',
    'Local/NewTxProposal', 'Local/TxProposalAction', 'Local/GlideraTx'
  ], function(eventName) {
    $rootScope.$on(eventName, function(event, untilItChanges) {
      self.updateAll({
        walletStatus: null,
        untilItChanges: untilItChanges,
        triggerTxUpdate: true,
      });
    });
  });

  $rootScope.$on('ScanFinished', function() {
    $log.debug('Scan Finished. Updating history');
    storageService.removeTxHistory(self.walletId, function() {
      self.updateAll({
        walletStatus: null,
        triggerTxUpdate: true,
      });
    });
  });

  lodash.each(['TxProposalRejectedBy', 'TxProposalAcceptedBy'], function(eventName) {
    $rootScope.$on(eventName, function() {
      var f = function() {
        if (self.updatingStatus) {
          return $timeout(f, 200);
        };
        self.updatePendingTxps();
      };
      f();
    });
  });

  $rootScope.$on('Local/NoWallets', function(event) {
    $timeout(function() {
      self.hasProfile = true;
      self.noFocusedWallet = true;
      self.isComplete = null;
      self.walletName = null;
      go.path('import');
    });
  });

  $rootScope.$on('Local/NewFocusedWallet', function() {
    self.setFocusedWallet();
    self.updateTxHistory();
    go.walletHome();
    storageService.getCleanAndScanAddresses(function(err, walletId) {
      if (walletId && profileService.walletClients[walletId]) {
        $log.debug('Clear last address cache and Scan ', walletId);
        addressService.expireAddress(walletId, function(err) {
          self.startScan(walletId);
        });
        storageService.removeCleanAndScanAddresses(function() {});
      }
    });
  });

  $rootScope.$on('Local/SetTab', function(event, tab, reset) {
    self.setTab(tab, reset);
  });

  $rootScope.$on('Local/RequestTouchid', function(event, cb) {
    window.plugins.touchid.verifyFingerprint(
      gettextCatalog.getString('Scan your fingerprint please'),
      function(msg) {
        // OK
        return cb();
      },
      function(msg) {
        // ERROR
        return cb(gettext('Invalid Touch ID'));
      }
    );
  });

  $rootScope.$on('Local/ShowAlert', function(event, msg, cb) {
    self.showErrorPopup(msg, cb);
  });

  $rootScope.$on('Local/NeedsPassword', function(event, isSetup, cb) {
    self.askPassword = {
      isSetup: isSetup,
      callback: function(err, pass) {
        self.askPassword = null;
        return cb(err, pass);
      },
    };
  });

  lodash.each(['NewCopayer', 'CopayerUpdated'], function(eventName) {
    $rootScope.$on(eventName, function() {
      // Re try to open wallet (will triggers)
      self.setFocusedWallet();
    });
  });

  $rootScope.$on('Local/NewEncryptionSetting', function() {
    var fc = profileService.focusedClient;
    self.isPrivKeyEncrypted = fc.isPrivKeyEncrypted();
    $timeout(function() {
      $rootScope.$apply();
    });
  });

  $rootScope.$on('Local/ThemeUpdated', function(event) {
    self.updateAll();
  });

  $rootScope.$on('Local/SkinUpdated', function(event) {
    self.updateAll();
  });

});
