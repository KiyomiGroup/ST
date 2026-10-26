/* Test double for the Supabase UMD global. Scenario comes from window.__SC. */
(function(){
  var listeners=[];
  function sc(){return window.__SC||{};}
  var session = null;
  try { var s=localStorage.getItem('fake_session'); if(s) session=JSON.parse(s); } catch(e){}
  window.__calls=[];
  window.supabase = { createClient: function(){ return {
    auth: {
      getSession: async function(){ window.__calls.push('getSession'); if(sc().sessionError) return {data:{session:null},error:{message:'boom'}}; return {data:{session:session},error:null}; },
      signInWithPassword: async function(a){ window.__calls.push('signIn'); 
        if(a.password!=='good') return {data:null,error:{message:'Invalid login credentials'}};
        session={user:{id:'u1',email:a.email}}; localStorage.setItem('fake_session',JSON.stringify(session)); return {data:{session:session,user:session.user},error:null}; },
      signOut: async function(){ window.__calls.push('signOut'); session=null; localStorage.removeItem('fake_session'); listeners.forEach(function(f){f('SIGNED_OUT',null)}); return {error:null}; },
      onAuthStateChange: function(f){ listeners.push(f); return {data:{subscription:{unsubscribe:function(){}}}}; },
      resetPasswordForEmail: async function(){ window.__calls.push('reset'); return {error:null}; }
    },
    rpc: async function(n){ window.__calls.push('rpc:'+n);
      if(sc().rpcError) return {data:null,error:{message:'server down'}};
      if(n==='is_active_coordinator') return {data: sc().role==='active', error:null};
      if(n==='is_coordinator') return {data: sc().role==='active'||sc().role==='inactive', error:null};
      return {data:null,error:{message:'unknown'}}; },
    from: function(t){ return { select:function(){return this;}, eq:function(){return this;}, maybeSingle: async function(){ window.__calls.push('from:'+t); return {data:{display_name:'Chidi Okafor',status:'active'},error:null}; } }; }
  };}};
})();
