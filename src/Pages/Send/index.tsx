import React, { useEffect, useState } from 'react';
import { PageProps, SpendFrom } from "../../globalTypes";
import { getNostrClient } from '../../Api'
import { notification } from 'antd';

//It import svg icons library
import * as Icons from "../../Assets/SvgIconLibrary";
import { AddressType, PayAddressResponse, PayInvoiceResponse } from '../../Api/autogenerated/ts/types';
import { UseModal } from '../../Hooks/UseModal';
import { useSelector, useDispatch } from 'react-redux';
import type { NotificationPlacement } from 'antd/es/notification/interface';
import axios from 'axios';
import { useIonRouter } from '@ionic/react';
import { Modal } from '../../Components/Modals/Modal';
import SpendFromDropdown from '../../Components/Dropdowns/SpendFromDropdown';
import { useLocation } from 'react-router-dom';
import { addTransaction } from '../../State/Slices/transactionSlice';

type PayInvoice = {
  type: 'payInvoice'
  invoice: string
  amount: number
}
type PayAddress = {
  type: 'payAddress'
  address: string
  amount: number
}

export const Send = () => {
  //parameter in url when click protocol
  const addressSearch = new URLSearchParams(useLocation().search);;
  const urlParam = addressSearch.get("url");
  
  const price = useSelector((state: any) => state.usdToBTC);

  //reducer
  const dispatch = useDispatch();
  const paySource = useSelector((state: any) => state.paySource).map((e: any) => { return { ...e } });
  const spendSources = useSelector((state: any) => state.spendSource).map((e: any) => { return { ...e } });

  const [error, setError] = useState("")
  const [vReceive, setVReceive] = useState(1);
  const [amountAssets, setAmountAssets] = useState("sats");
  const [amount, setAmount] = useState("");
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const { isShown, toggle } = UseModal();
  const [selectedSource, setSelectedSource] = useState(spendSources[0]);

  const nostrSource = paySource.filter((e: any) => e.pasteField.includes("nprofile"))

  const router = useIonRouter();

  const [api, contextHolder] = notification.useNotification();
  const openNotification = (placement: NotificationPlacement, header: string, text: string) => {
    api.info({
      message: header,
      description:
        text,
      placement
    });
  };

  useEffect(() => {
    if (spendSources.length === 0) {
      setTimeout(() => {
        router.push("/home");
      }, 1000);
      return openNotification("top", "Error", "You don't have any source!");
    }

    setTo(urlParam??"")
  }, []);

  const pay = async (action: PayInvoice | PayAddress) => {
    if (!nostrSource.length) return;
    switch (action.type) {
      case 'payAddress':
        const resA = await (await getNostrClient(selectedSource.pasteField)).PayAddress({
          address: action.address,
          amoutSats: +amount,
          satsPerVByte: 10
        })
        if (resA.status !== 'OK') {
          setError(resA.reason)
          return
        }
        return resA;
      case 'payInvoice':
        const resI = await (await getNostrClient(selectedSource.pasteField)).PayInvoice({
          invoice: action.invoice,
          amount: 0,
        })
        if (resI.status !== 'OK') {
          setError(resI.reason)
          return
        }
        return resI;
    }
  }
  const [loading, setLoading] = useState("none");
  const handleSubmit = async () => {
    setLoading("flex")
    if (selectedSource.pasteField.includes("nprofile")) {
      await payUsingNprofile();
      setLoading("none")
    }else {

    }
  }

  const payUsingNprofile = async () => {
    let payRes: ({ status: "OK"; } & PayAddressResponse) | ({ status: "OK"; } & PayInvoiceResponse) | undefined;
    const expression: RegExp = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
    if (expression.test(to)) {
      try {
        const payLink = "https://" + to.split("@")[1] + "/.well-known/lnurlp/" + to.split("@")[0];
        const res = await axios.get(payLink);
        const callbackURL = await axios.get(
          res.data.callback + (res.data.callback.includes('?') ? "&" : "?") + "amount=" + (amount === "" ? res.data.minSendable : parseInt(amount) * 1000),
          {
            headers: {
              'Content-Type': 'application/json',
              withCredentials: false,
            }
          }
        );
        console.log(callbackURL);
        
        if (callbackURL.data.success===false) {
          return openNotification("top", "Error", callbackURL.data.error);
        }
        payRes = await pay(
          {
            type: 'payInvoice',
            invoice: callbackURL.data.pr,
            amount: +amount,
          }
        )
        if (payRes?.status == "OK") {
          dispatch(addTransaction({
            amount: amount,
            memo: note,
            time: Date.now(),
            destination: to,
            inbound: false,
            confirm: payRes,
            invoice: callbackURL.data.pr,
          }))
          openNotification("top", "Success", "Successfully paid.");
        }else {
          return openNotification("top", "Error", "Failed transaction.");
        }
      } catch (error) {
        return openNotification("top", "Error", "Couldn't send using this info.");
      }
    }else if (to.includes("lnbc")) {
      try {
        const result = await (await getNostrClient(selectedSource.pasteField)).DecodeInvoice({invoice:to});
        if (result.status != "OK") {
          return;
        }
        payRes = await pay(
          {
            type: 'payInvoice',
            invoice: to,
            amount: result.amount,
          }
        )
        console.log(result,"this is decoded invocie");
        if (payRes?.status == "OK") {
          openNotification("top", "Success", "Successfully paid.");
          await (await getNostrClient(selectedSource.pasteField)).GetUserOperations({
            latestIncomingInvoice: 0,
            latestOutgoingInvoice: 0,
            latestIncomingTx: 0,
            latestOutgoingTx: 0,
            latestIncomingUserToUserPayment: 0,
            latestOutgoingUserToUserPayment: 0,
          }).then(ops => {
            if (ops.status === 'OK') {
              console.log((ops), "ops")
              ops.latestOutgoingTxOperations
              dispatch(addTransaction({
                amount: result.amount+"",
                memo: note,
                time: Date.now(),
                destination: to,
                inbound: false,
                confirm: payRes,
                invoice: ops.latestOutgoingTxOperations.operations[0].identifier,
              }))
            } else {
                console.log(ops.reason, "ops.reason")
            }
          })
        }else {
          return openNotification("top", "Error", "Failed transaction.");
        }
      } catch (error) {
        console.log(error);
        return openNotification("top", "Error", "Couldn't send using this info.");
      }
    }else {
      try {
        payRes = await pay(
          {
            type: "payAddress",
            address: to,
            amount: +amount,
          }
        )
        if (payRes?.status == "OK") {
          openNotification("top", "Success", "Successfully paid.");

          dispatch(addTransaction({
            amount: amount,
            memo: note,
            time: Date.now(),
            destination: to,
            inbound: false,
            confirm: payRes,
            invoice: to,
          }))
        }else {
          return openNotification("top", "Error", "Failed transaction.");
        }
      } catch (error) {
        return openNotification("top", "Error", "Couldn't send using this info.");
      }
    }
    setTimeout(() => {
      router.push("/home")
    }, 500);
  }

  const onChangeTo = async (e: string) => {
    setTo(e);
    if (selectedSource.pasteField.includes("lnbc")) {
      try {
        const result = await (await getNostrClient(selectedSource.pasteField)).DecodeInvoice({invoice:to});
        if (result.status != "OK") {
          return;
        }
        setAmount(result.amount.toString());
      } catch (error) {
        console.log(error);
      }
    }
  }

  const confirmContent = <React.Fragment>
    <div className="Sources_notify">
      <div className="Sources_notify_title">Amount to Receive</div>
      <button className="Sources_notify_button" onClick={toggle}>OK</button>
    </div>
  </React.Fragment>;

  return (
    <div className='Send_container'>
      <div className='Send_loading' style={{display: loading}}>
        <div className='Send_img'>
          {Icons.Animation()}
          <p>Sending</p>
        </div>
      </div>
      {contextHolder}
      <div className="Send" style={{ opacity: vReceive, zIndex: vReceive ? 1000 : -1 }}>
        <div className="Send_header_text">Send Payment</div>
        <div className="Send_config">
          <div className="Send_amount">
            Amount:
            <div className='Send_amount_container'>
              <input className="Send_amount_input" type="number" value={amount} onChange={(e) => { setAmount(e.target.value) }} />
              <button onClick={() => { setAmountAssets(amountAssets === "BTC" ? "sats" : "BTC") }}>{amountAssets}</button>
            </div>
          </div>
          <div className='Send_available_amount'>
            ~ ${parseInt(amount === "" ? "0" : amount) === 0 ? 0 : (parseInt(amount === "" ? "0" : amount) * price.buyPrice * (amountAssets === "BTC" ? 1 : 0.00000001)).toFixed(2)}
          </div>
          <div className="Send_to">
            <p>To:</p>
            <input type="text" placeholder="Invoice, Bitcoin or Lightning Address, nPub, Email" value={to} onChange={(e) => { onChangeTo(e.target.value) }} />
          </div>
          <div className="Send_for">
            <p>For:</p>
            <input type="text" placeholder="Add a note" value={note} onChange={(e) => { setNote(e.target.value) }} />
          </div>
          <div className="Send_from">
            <p>Spend From:</p>
            <SpendFromDropdown values={spendSources} initialValue={spendSources[0]} callback={setSelectedSource}/>
          </div>
        </div>
      </div>
      <div className="Send_other_options">
        <div className="Send_lnurl">
          <div className="Send_set_amount_copy">
            <button onClick={() => { router.goBack() }}>{Icons.Close()}CANCEL</button>
          </div>
        </div>
        <div className="Send_chain">
          <div className="Send_set_amount_copy">
            <button onClick={handleSubmit}>{Icons.send()}SEND</button>
          </div>
        </div>
      </div>
      <Modal isShown={isShown} hide={toggle} modalContent={confirmContent} headerText={''} />
    </div>
  )
}