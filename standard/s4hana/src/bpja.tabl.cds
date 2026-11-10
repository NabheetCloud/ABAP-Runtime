@EndUserText.label : 'Project budget annual values (classic)'
define table bpja {
  key mandt : abap.clnt not null;
  key lednr : abap.char(20) not null;
  key objnr : abap.char(22) not null;
  key trgkz : abap.char(20) not null;
  key wrttp : abap.char(20) not null;
  key gjahr : abap.numc(4) not null;
  key geber : abap.char(20) not null;
  key versn : abap.char(4) not null;
  key vorga : abap.char(20) not null;
  key twaer : abap.char(20) not null;
  wtjhr     : abap.char(20);
  wljhr     : abap.char(20);
}
