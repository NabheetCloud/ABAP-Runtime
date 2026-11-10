@EndUserText.label : 'Ledgers'
define table finsc_ledger {
  key mandt       : abap.clnt not null;
  key rldnr       : abap.char(2) not null;
  xleading        : abap.char(20);
  ledger_type     : abap.char(20);
  name            : abap.char(40);
}
